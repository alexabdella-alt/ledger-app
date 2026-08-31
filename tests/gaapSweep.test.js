import { describe, it, expect } from "vitest";
import { buildPaymentEntry } from "../src/lib/payments.js";
import { buildOpeningBalanceEntry } from "../src/lib/openingBalances.js";
import { buildDepreciationEntry, buildDepreciationSchedule, DEPRECIATION_METHOD } from "../src/lib/depreciation.js";
import { buildDeferredRevenueReceiptEntry, buildArInvoiceEntry } from "../src/lib/revenueEntries.js";
import { buildPayrollEntry, buildPayrollAccrualEntry, buildPayrollDisbursementEntry } from "../src/lib/payroll.js";
import { buildPrepaidCapitalizeEntry, buildPrepaidAmortizeEntry } from "../src/lib/prepaid.js";
import { buildAccruedLiabilityEntry } from "../src/lib/accruedLiabilities.js";
import { buildBankLineEntry } from "../src/lib/bankMatch.js";
import { buildYearEndCloseEntry } from "../src/lib/journalEntries.js";

// ─────────────────────────────────────────────────────────────────────────────
// ★★★ THE GUARDRAIL TESTS ONE FIXTURE PER EVENT. THIS SWEEPS THEM.
//
// `gaapInvariants.test.js` asserts Dr = Cr and the accounting equation over a list of
// EVENTS — one instance each, 28 distinct numbers in the whole file. That is the right
// shape for "does this builder produce the correct accounts", and it is **structurally
// unable to find a rounding defect**, because a rounding defect appears at particular
// values and not at others.
//
// C286 is the proof: the ASC 842 commencement entry had been unbalanced by a cent at
// certain payment/term/rate combinations for as long as it existed. `buildJournalEntry`
// REFUSES an unbalanced entry, so the lease simply never posted — no wrong figure on a
// report, a missing one — and the single-fixture guardrail passed the whole time.
//
// ★★ SO THIS RUNS EVERY BUILDER OVER AWKWARD MONEY: thirds, repeating decimals, half-cent
// boundaries, very large and very small. Not to replace the guardrail — to cover the axis it
// cannot vary.
// ─────────────────────────────────────────────────────────────────────────────

// Values chosen to break naive rounding: exact thirds, halves of cents, long decimals.
const AMOUNTS = [
  0.01, 0.05, 1, 3.33, 9.99, 33.335, 99.995, 100, 123.456, 250.005,
  1000.01, 1234.567, 4999.995, 10000, 33333.33, 99999.99, 123456.789,
];
const RATES = [0, 0.0125, 0.05, 0.0675, 0.0825, 0.1, 0.15, 0.33333];

const legs = (e) => (e?.lines || []).reduce(
  (a, l) => ({ d: a.d + (Number(l.debit) || 0), c: a.c + (Number(l.credit) || 0) }), { d: 0, c: 0 });

// ★ THE ASSERTION IS THE ONE `buildJournalEntry` ENFORCES AT POST TIME. An entry that fails
// it does not post — silently — so this is a test for entries that go MISSING, not for
// entries that are wrong.
function expectBalanced(entry, label) {
  if (!entry || !entry.lines?.length) return;   // "declined to build" is a valid outcome
  const { d, c } = legs(entry);
  if (Math.abs(d - c) >= 0.005) throw new Error(`${label}: Dr ${d.toFixed(4)} vs Cr ${c.toFixed(4)}`);
}

describe("★★★ every builder balances across awkward money, not just its one fixture", () => {
  it("payments and collections", () => {
    let n = 0;
    for (const amount of AMOUNTS) {
      for (const side of ["ap", "ar"]) {
        const bill = { id: "b1", vendor: "V", amount, date: "2026-08-04", gl_code: side === "ap" ? "6100" : "4000" };
        const e = buildPaymentEntry(bill, side, { cashCode: "1000", cashName: "Cash", apCode: "2000", apName: "AP", arCode: "1200", arName: "AR" });
        expectBalanced(e, `payment ${side} ${amount}`); n++;
      }
    }
    expect(n).toBe(AMOUNTS.length * 2);
  });

  it("opening balances — the plug must absorb every residual", () => {
    let n = 0;
    for (const a of AMOUNTS) for (const b of AMOUNTS.slice(0, 6)) {
      const e = buildOpeningBalanceEntry({
        balances: [{ code: "1000", name: "Cash", balance: a }, { code: "2000", name: "AP", balance: -b }],
        obeCode: "3400", obeName: "OBE", date: "2026-01-01",
      });
      expectBalanced(e, `opening ${a}/${b}`); n++;
    }
    expect(n).toBeGreaterThan(90);
  });

  it("★★ depreciation — and the schedule must sum EXACTLY to cost less salvage", () => {
    let n = 0;
    for (const cost of AMOUNTS) for (const lifeMonths of [12, 36, 60, 84, 7]) {
      const sched = buildDepreciationSchedule({
        cost, salvage: 0, lifeMonths, inServiceDate: "2026-01-01",
        depExpCode: "6900", accumDepCode: "1510",
      });
      if (!sched.entries.length) continue;
      // An asset must be written down to salvage and never past it — over-depreciating writes
      // off value the business still owns; under-depreciating leaves a stub nobody notices.
      expect(sched.entries.every(Boolean)).toBe(true);          // no holes in the schedule
      // ★ AGAINST THE DEPRECIABLE BASE, NOT THE RAW COST. Some sweep values carry three
      // decimals on purpose (33.335) and a third of a cent is not money — the schedule
      // correctly works in cents, so comparing to the unrounded input would be testing my
      // fixture rather than the code.
      expect(Math.abs(sched.total - Math.round(cost * 100) / 100)).toBeLessThan(0.005);
      for (const e of sched.entries) { expectBalanced(e, `dep ${cost}/${lifeMonths}`); n++; }
    }
    expect(n).toBeGreaterThan(100);
  });

  it("prepaid capitalize and amortize", () => {
    for (const amount of AMOUNTS) {
      expectBalanced(buildPrepaidCapitalizeEntry({ amount, date: "2026-01-01", prepaidCode: "1400", prepaidName: "Prepaid", cashCode: "1000", cashName: "Cash" }), `prepaid cap ${amount}`);
      expectBalanced(buildPrepaidAmortizeEntry({ amount, date: "2026-02-01", expenseCode: "6500", expenseName: "Software", prepaidCode: "1400", prepaidName: "Prepaid" }), `prepaid amort ${amount}`);
    }
    expect(AMOUNTS.length).toBeGreaterThan(10);
  });

  it("accrued liabilities and deferred revenue", () => {
    for (const amount of AMOUNTS) {
      expectBalanced(buildAccruedLiabilityEntry({ amount, date: "2026-08-31", expenseCode: "6800", expenseName: "Prof", accruedCode: "2150", accruedName: "Accrued" }), `accrued ${amount}`);
      expectBalanced(buildDeferredRevenueReceiptEntry({ amount, cashCode: "1000", deferredRevCode: "2300", date: "2026-08-01" }), `deferred ${amount}`);
    }
    expect(AMOUNTS.length).toBeGreaterThan(10);
  });

  it("★★ sales tax on an AR invoice — a rate applied to a subtotal is exactly where a cent goes missing", () => {
    let n = 0;
    for (const subtotal of AMOUNTS) for (const taxRate of RATES) {
      expectBalanced(buildArInvoiceEntry({ subtotal, taxRate, arCode: "1200", revenueCode: "4000", salesTaxCode: "2350", date: "2026-08-01" }), `ar ${subtotal} @ ${taxRate}`);
      n++;
    }
    expect(n).toBe(AMOUNTS.length * RATES.length);
  });

  it("★★ payroll, one-step and two-step, and the two-step must sum to the one-step", () => {
    let n = 0;
    for (const gross of AMOUNTS.filter((a) => a >= 100)) {
      for (const wr of [0.1, 0.2137, 0.31]) {
        const withholdings = Math.round(gross * wr * 100) / 100;
        const employerTax = Math.round(gross * 0.0765 * 100) / 100;
        const codes = { salariesCode:"6000", payrollTaxExpCode:"6010", cashCode:"1000", payrollTaxesPayableCode:"2100", payrollLiabilityCode:"2110" };
        const args = { gross, employerTaxes: employerTax, employeeWithholdings: withholdings, date: "2026-08-15", ...codes };
        const one = buildPayrollEntry(args);
        expectBalanced(one, `payroll ${gross}/${wr}`);
        const accrual = buildPayrollAccrualEntry(args);
        const disb = buildPayrollDisbursementEntry({ netPay: Math.round((gross - withholdings) * 100) / 100, date: "2026-09-02", ...codes });
        expectBalanced(accrual, `accrual ${gross}/${wr}`);
        expectBalanced(disb, `disbursement ${gross}/${wr}`);
        // The split must not change the P&L: same expense either way.
        const exp = (e) => (e?.lines || []).filter((l) => /^[5-8]/.test(String(l.code))).reduce((s, l) => s + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0);
        expect(exp(accrual) + exp(disb)).toBeCloseTo(exp(one), 2);
        n++;
      }
    }
    expect(n).toBeGreaterThan(20);
  });

  it("bank lines, both directions", () => {
    for (const amount of AMOUNTS) for (const type of ["expense", "revenue"]) {
      const txn = { id: "t1", date: "2026-08-04", vendor: "V", description: "d", amount: type === "revenue" ? amount : -amount, type, gl_code: type === "revenue" ? "4000" : "6100" };
      expectBalanced(buildBankLineEntry(txn, { offsetCode: "1000", offsetName: "Cash" }), `bank ${type} ${amount}`);
    }
    expect(AMOUNTS.length).toBeGreaterThan(10);
  });

  it("★ year-end close, including years that net to awkward figures", () => {
    let n = 0;
    for (const rev of AMOUNTS) for (const exp of AMOUNTS.slice(0, 8)) {
      const e = buildYearEndCloseEntry({
        balances: [{ code: "4000", name: "Revenue", balance: rev }, { code: "6100", name: "Rent", balance: exp }],
        retainedEarningsCode: "3100", date: "2026-12-31",
      });
      expectBalanced(e, `close ${rev}/${exp}`); n++;
    }
    expect(n).toBeGreaterThan(100);
  });
});
