import { describe, it, expect } from "vitest";
import { buildPayrollEntry, isPayrollBankLine, matchPayrollBankLine, planPayrollBankLines, flagIncompletePayroll, PAYROLL_INCOMPLETE_NOTE } from "../src/lib/payroll.js";

const WAGES = "6000", PTAX = "6010", CASH = "1000", PTP = "2101";
const codes = { salariesCode: WAGES, payrollTaxExpCode: PTAX, cashCode: CASH, payrollTaxesPayableCode: PTP };
const sumD = ls => ls.reduce((s, l) => s + (l.debit || 0), 0);
const sumC = ls => ls.reduce((s, l) => s + (l.credit || 0), 0);

describe("buildPayrollEntry (#13) — Dr Salaries+Tax / Cr Cash+Payroll Taxes Payable", () => {
  it("standard run via withholdings: gross 10000, withhold 2000, employer 765", () => {
    const je = buildPayrollEntry({ gross: 10000, employeeWithholdings: 2000, employerTaxes: 765, ...codes, date: "2026-06-15" });
    expect(je.balanced).toBe(true);
    expect(je.lines).toEqual([
      { code: WAGES, name: null, debit: 10000, credit: 0, memo: null },   // Dr Salaries (gross)
      { code: PTAX,  name: null, debit: 765,   credit: 0, memo: null },   // Dr Payroll Tax Exp (employer)
      { code: CASH,  name: null, debit: 0, credit: 8000, memo: null },    // Cr Cash (net = 10000 − 2000)
      { code: PTP,   name: null, debit: 0, credit: 2765, memo: null },    // Cr Payroll Taxes Payable (2000 + 765)
    ]);
  });

  it("net pay → Cash (already-disbursed), NOT accrued; derives withholdings from netPay", () => {
    const je = buildPayrollEntry({ gross: 10000, netPay: 8000, employerTaxes: 765, ...codes });
    const cash = je.lines.find(l => l.code === CASH);
    expect(cash).toEqual({ code: CASH, name: null, debit: 0, credit: 8000, memo: null });
    expect(je.lines.some(l => l.code === "2100")).toBe(false);   // never Accrued Liabilities
    expect(je.lines.find(l => l.code === PTP).credit).toBe(2765);
  });

  it("balance identity holds: debits = gross + employer; credits = net + (withholdings + employer)", () => {
    const je = buildPayrollEntry({ gross: 12345.67, employeeWithholdings: 3210.5, employerTaxes: 944.4, ...codes });
    expect(sumD(je.lines)).toBe(sumC(je.lines));
    expect(sumD(je.lines)).toBe(Math.round((12345.67 + 944.4) * 100) / 100);
  });

  it("sales tax is NOT touched and payroll taxes go to their OWN liability (2101, not 2350/2100)", () => {
    const je = buildPayrollEntry({ gross: 5000, employeeWithholdings: 1000, employerTaxes: 380, ...codes });
    const liabLines = je.lines.filter(l => String(l.code)[0] === "2");
    expect(liabLines).toEqual([{ code: PTP, name: null, debit: 0, credit: 1380, memo: null }]);
  });

  it("edge: withholdings = 0 and employer = 0 → Dr Salaries / Cr Cash (gross = net)", () => {
    const je = buildPayrollEntry({ gross: 4000, employeeWithholdings: 0, employerTaxes: 0, ...codes });
    expect(je.lines).toEqual([
      { code: WAGES, name: null, debit: 4000, credit: 0, memo: null },
      { code: CASH,  name: null, debit: 0, credit: 4000, memo: null },
    ]);
    expect(je.balanced).toBe(true);
  });

  it("edge: employer = 0 but withholdings > 0 → no Payroll Tax Exp line; PTP = withholdings", () => {
    const je = buildPayrollEntry({ gross: 4000, employeeWithholdings: 600, employerTaxes: 0, ...codes });
    expect(je.lines.some(l => l.code === PTAX)).toBe(false);
    expect(je.lines.find(l => l.code === CASH).credit).toBe(3400);
    expect(je.lines.find(l => l.code === PTP).credit).toBe(600);
    expect(je.balanced).toBe(true);
  });

  it("resolves by whatever code the caller passes (works for legacy 5101 payroll-tax)", () => {
    const je = buildPayrollEntry({ gross: 1000, employeeWithholdings: 200, employerTaxes: 76.5, ...codes, payrollTaxExpCode: "5101" });
    expect(je.lines.find(l => l.debit === 76.5).code).toBe("5101");
    expect(je.balanced).toBe(true);
  });

  it("returns null on invalid inputs (no gross, net>gross, missing core accounts)", () => {
    expect(buildPayrollEntry({ gross: 0, ...codes })).toBe(null);
    expect(buildPayrollEntry({ gross: 1000, netPay: 1200, ...codes })).toBe(null);   // net > gross → withholdings negative
    expect(buildPayrollEntry({ gross: 1000, employeeWithholdings: 0, salariesCode: WAGES })).toBe(null); // no cash code
  });
});

// ── O72: bank net-pay line ↔ register reconciliation (no double-count) ────────
describe("O72 payroll-from-statement — match the register's net, never double-book", () => {
  // A booked payroll REGISTER run (buildPayrollEntry stamps import_metadata.kind='payroll').
  const registerRun = (over = {}) => ({
    id: "reg1", db_entry_id: "je-reg1", date: "2026-06-15", status: "posted",
    import_metadata: { kind: "payroll", gross: 6000, net: 4401, withholdings: 1599, employer_taxes: 459 },
    ...over,
  });
  const bankNet = (over = {}) => ({ id: "bl1", date: "2026-06-16", vendor: "PAYROLL JANE SMITH", description: "PAYROLL JANE SMITH NET", amount: 4401, type: "expense", gl_code: "6000", ...over });

  it("(detect) isPayrollBankLine recognizes payroll net lines, not generic expenses", () => {
    expect(isPayrollBankLine({ description: "PAYROLL JANE SMITH NET" })).toBe(true);
    expect(isPayrollBankLine({ vendor: "Gusto", description: "direct deposit" })).toBe(true);
    expect(isPayrollBankLine({ vendor: "Adobe", description: "monthly subscription" })).toBe(false);
    expect(isPayrollBankLine({ vendor: "AWS", description: "cloud" })).toBe(false);
  });

  it("(b) a bank net-pay line MATCHES the register's net → suppressed, NOT re-booked", () => {
    const ledger = [registerRun()];
    const plan = planPayrollBankLines([bankNet()], ledger);
    expect(plan.matched).toHaveLength(1);
    expect(plan.matched[0].matchId).toBe("je-reg1");
    expect(plan.incomplete).toHaveLength(0);   // not flagged
    expect(plan.rest).toHaveLength(0);          // not direct-booked
  });

  it("matchPayrollBankLine ties on NET (not gross), within a date window; wrong amount misses", () => {
    const ledger = [registerRun()];
    expect(matchPayrollBankLine(bankNet({ amount: 4401 }), ledger)).toBeTruthy();
    expect(matchPayrollBankLine(bankNet({ amount: 6000 }), ledger)).toBeNull();   // gross ≠ the cash disbursement
    expect(matchPayrollBankLine(bankNet({ date: "2026-09-01" }), ledger)).toBeNull(); // outside window
  });

  it("(c) register + statement together = ONE payroll cost — the net line adds nothing", () => {
    // The register already booked Dr Salaries 6000 (gross). The bank net line is the SAME
    // disbursement → matched/suppressed, so salaries are counted once (6000), not 6000+4401.
    const ledger = [registerRun()];
    const plan = planPayrollBankLines([bankNet()], ledger);
    const extraSalaryBooked = plan.rest.length + plan.incomplete.length;   // what WOULD post a salary line
    expect(extraSalaryBooked).toBe(0);                                     // nothing extra → no double-count
    // two employees' runs match their two bank lines independently (no cross/double match)
    const reg2 = registerRun({ id: "reg2", db_entry_id: "je-reg2", import_metadata: { kind: "payroll", gross: 3000, net: 2200 } });
    const plan2 = planPayrollBankLines([bankNet(), bankNet({ id: "bl2", amount: 2200 })], [registerRun(), reg2]);
    expect(plan2.matched.map(m => m.matchId).sort()).toEqual(["je-reg1", "je-reg2"]);
    expect(plan2.incomplete).toHaveLength(0);
  });

  it("(d) bank net line with NO register → flagged incomplete (net booked, but low-confidence + honest note)", () => {
    const plan = planPayrollBankLines([bankNet()], []);   // no register in the ledger
    expect(plan.matched).toHaveLength(0);
    expect(plan.incomplete).toHaveLength(1);
    const flagged = flagIncompletePayroll(plan.incomplete[0]);
    expect(flagged.confidence).toBe(40);                  // low → O49 flags it for review
    expect(flagged.payroll_incomplete).toBe(true);
    expect(flagged.reasoning).toBe(PAYROLL_INCOMPLETE_NOTE);
    expect(flagged.reasoning).toMatch(/register|understates|withholding/i);   // honest about what's missing
  });

  it("non-payroll standalone lines pass through untouched (no false positives)", () => {
    const adobe = { id: "x", vendor: "Adobe", description: "subscription", amount: 80, gl_code: "6500" };
    const plan = planPayrollBankLines([adobe], [registerRun()]);
    expect(plan.rest).toEqual([adobe]);
    expect(plan.matched).toHaveLength(0);
    expect(plan.incomplete).toHaveLength(0);
  });
});
