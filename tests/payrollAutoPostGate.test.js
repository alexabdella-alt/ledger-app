import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  payrollAutoPostGate, payrollHistoryFromLedger, payrollEntryForImport,
  payrollAutoPostNarration, registerFromParsedPayroll,
  PAYROLL_GATE, PAYROLL_NORM_TOLERANCE,
} from "../src/lib/payroll.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ─────────────────────────────────────────────────────────────────────────────
// C198·3a — the payroll auto-post GATE.
//
// The gate is the entire safety argument for auto-post: it sits downstream of AI
// extraction, which has hallucinated a payroll run before (the O86 phantom —
// 06-20, $10,000/$7,335, matching no register on file). So the tests that matter
// are the MUTATIONS: break each condition on its own and prove the gate refuses.
// ─────────────────────────────────────────────────────────────────────────────

// A standard biweekly run: 06-01→06-14, paid 06-19, foots exactly.
const STANDARD = {
  periodStart: "2026-06-01", periodEnd: "2026-06-14", payDate: "2026-06-19",
  gross: 12000, withholdings: 3000, net: 9000, employerTax: 918,
};
// Two prior attested runs → trailing average gross 11,950.
const HISTORY = [{ date: "2026-05-17", gross: 11800 }, { date: "2026-05-31", gross: 12100 }];
const AVG = 11950;

const codesOf = (g) => g.reasons.map(r => r.code);

describe("payrollAutoPostGate — the clean path", () => {
  it("a standard register with an established norm posts itself", () => {
    const g = payrollAutoPostGate(STANDARD, HISTORY);
    expect(g.reasons).toEqual([]);
    expect(g.pass).toBe(true);
  });

  it("every reason carries a code AND plain-CPA text", () => {
    const g = payrollAutoPostGate({}, []);
    expect(g.pass).toBe(false);
    for (const r of g.reasons) {
      expect(Object.values(PAYROLL_GATE)).toContain(r.code);
      expect(typeof r.text).toBe("string");
      expect(r.text.length).toBeGreaterThan(10);
    }
  });
});

describe("payrollAutoPostGate — MUTATIONS: each condition broken on its own", () => {
  // Each mutation is built so it trips EXACTLY the condition under test — otherwise
  // a passing assertion could be another check catching it by luck.

  it("1 · shape — a missing period end is not a recognized register", () => {
    const g = payrollAutoPostGate({ ...STANDARD, periodEnd: null }, HISTORY);
    expect(g.pass).toBe(false);
    expect(codesOf(g)).toEqual([PAYROLL_GATE.SHAPE]);
    expect(g.reasons[0].text).toMatch(/pay period end/);
  });

  it("2 · foots — net that isn't gross minus withholdings is refused to the cent", () => {
    const g = payrollAutoPostGate({ ...STANDARD, net: 9000.01 }, HISTORY);
    expect(g.pass).toBe(false);
    expect(codesOf(g)).toEqual([PAYROLL_GATE.FOOTS]);
  });

  it("2 · foots — negative employer taxes are refused", () => {
    const g = payrollAutoPostGate({ ...STANDARD, employerTax: -1 }, HISTORY);
    expect(g.pass).toBe(false);
    expect(codesOf(g)).toEqual([PAYROLL_GATE.FOOTS]);
  });

  it("3 · consistency — net that isn't less than gross is refused (and still foots)", () => {
    // withholdings 0 keeps the footing identity true, so ONLY consistency can fail.
    const g = payrollAutoPostGate({ ...STANDARD, withholdings: 0, net: 12000 }, HISTORY);
    expect(g.pass).toBe(false);
    expect(codesOf(g)).toEqual([PAYROLL_GATE.CONSISTENT]);
  });

  it("4 · pay date — more than a week after period end is refused", () => {
    const g = payrollAutoPostGate({ ...STANDARD, payDate: "2026-06-22" }, HISTORY);
    expect(g.pass).toBe(false);
    expect(codesOf(g)).toEqual([PAYROLL_GATE.PAY_DATE]);
  });

  it("4 · pay date — exactly 7 days after period end is still adjacent (boundary holds)", () => {
    expect(payrollAutoPostGate({ ...STANDARD, payDate: "2026-06-21" }, HISTORY).pass).toBe(true);
    expect(payrollAutoPostGate({ ...STANDARD, payDate: "2026-06-14" }, HISTORY).pass).toBe(true);  // last day in period
    expect(payrollAutoPostGate({ ...STANDARD, payDate: "2026-06-01" }, HISTORY).pass).toBe(true);  // first day in period
  });

  it("4 · pay date — before the period starts is refused", () => {
    const g = payrollAutoPostGate({ ...STANDARD, payDate: "2026-05-31" }, HISTORY);
    expect(g.pass).toBe(false);
    expect(codesOf(g)).toEqual([PAYROLL_GATE.PAY_DATE]);
  });

  it("5 · norms — gross well outside the trailing average is refused (and still foots)", () => {
    const g = payrollAutoPostGate({ ...STANDARD, gross: 30000, withholdings: 7500, net: 22500 }, HISTORY);
    expect(g.pass).toBe(false);
    expect(codesOf(g)).toEqual([PAYROLL_GATE.NORM]);
  });

  it("5 · norms — the ±50% band is inclusive at its edges, exclusive beyond", () => {
    const hi = AVG * (1 + PAYROLL_NORM_TOLERANCE);          // 17,925
    const lo = AVG * (1 - PAYROLL_NORM_TOLERANCE);          //  5,975
    const at = (gross) => payrollAutoPostGate(
      { ...STANDARD, gross, withholdings: gross * 0.25, net: gross * 0.75 }, HISTORY);
    expect(at(hi).pass).toBe(true);
    expect(at(lo).pass).toBe(true);
    expect(codesOf(at(hi + 1))).toEqual([PAYROLL_GATE.NORM]);
    expect(codesOf(at(lo - 1))).toEqual([PAYROLL_GATE.NORM]);
  });
});

describe("payrollAutoPostGate — the first register is ALWAYS human-confirmed", () => {
  it("no prior payroll → no norm → never auto-post, even when internally perfect", () => {
    const g = payrollAutoPostGate(STANDARD, []);
    expect(g.pass).toBe(false);
    expect(codesOf(g)).toEqual([PAYROLL_GATE.NORM]);
    // C198·3c — the reason is a claim about the QUERY, never about the world. Franklin Ave
    // had twelve priors when the old string told the operator this was its first payroll.
    expect(g.reasons[0].text).toBe("We couldn't find any prior payroll for this company — someone should check this one by hand.");
    expect(g.reasons[0].text).not.toMatch(/this is the first|first payroll we/i);
  });

  it("the SAME register passes once one prior run exists — the norm is what changed", () => {
    expect(payrollAutoPostGate(STANDARD, []).pass).toBe(false);
    expect(payrollAutoPostGate(STANDARD, [{ date: "2026-05-31", gross: 12000 }]).pass).toBe(true);
  });

  it("a history of only voided/zero runs is still no norm", () => {
    expect(payrollAutoPostGate(STANDARD, [{ gross: 0 }, { gross: null }]).pass).toBe(false);
  });
});

describe("payrollAutoPostGate — the O86 phantom cannot auto-post", () => {
  // Live O86: an extraction claiming 06-20 / $10,000 gross / $7,335 net that matched
  // no register on file — no period, no withholdings total, no employer taxes.
  const PHANTOM = registerFromParsedPayroll({
    pay_date: "2026-06-20", total_gross: 10000, total_net: 7335,
  });

  it("fails at least two independent conditions", () => {
    const g = payrollAutoPostGate(PHANTOM, HISTORY);
    expect(g.pass).toBe(false);
    expect(new Set(codesOf(g)).size).toBeGreaterThanOrEqual(2);
    expect(codesOf(g)).toContain(PAYROLL_GATE.SHAPE);
    expect(codesOf(g)).toContain(PAYROLL_GATE.FOOTS);
  });

  it("its gross sits INSIDE the norm band — so the norm check alone would have let it through", () => {
    // The point of the shape + footing conditions: a plausible-looking hallucination
    // is not caught by reasonableness. It's caught by not being a whole register.
    expect(Math.abs(10000 - AVG)).toBeLessThan(AVG * PAYROLL_NORM_TOLERANCE);
    expect(codesOf(payrollAutoPostGate(PHANTOM, HISTORY))).not.toContain(PAYROLL_GATE.NORM);
  });

  it("still fails with no history at all", () => {
    expect(payrollAutoPostGate(PHANTOM, []).pass).toBe(false);
  });
});

describe("payrollHistoryFromLedger — the norm's input", () => {
  const SALARIES = "6000";
  const row = (over) => ({ import_metadata: { kind: "payroll" }, db_entry_id: "e1", date: "2026-05-31", gl_code: SALARIES, debit_credit: "debit", amount: 0, ...over });

  it("prefers the entry's own stamped gross", () => {
    const h = payrollHistoryFromLedger([
      row({ import_metadata: { kind: "payroll", gross: 11800 }, amount: 11800 }),
    ], { salariesCode: SALARIES });
    expect(h).toEqual([{ id: "e1", date: "2026-05-31", gross: 11800 }]);
  });

  it("falls back to the Salaries & Wages debit for runs posted before the stamp existed", () => {
    const h = payrollHistoryFromLedger([
      row({ amount: 11800 }),                                                   // salaries leg = gross
      row({ gl_code: "1000", debit_credit: "credit", amount: 9000 }),           // cash leg — ignored
    ], { salariesCode: SALARIES });
    expect(h).toEqual([{ id: "e1", date: "2026-05-31", gross: 11800 }]);
  });

  it("never counts a voided run toward the norm", () => {
    const h = payrollHistoryFromLedger([
      row({ amount: 11800, status: "voided" }),
    ], { salariesCode: SALARIES });
    expect(h).toEqual([]);
  });

  it("ignores non-payroll entries entirely", () => {
    const h = payrollHistoryFromLedger([
      { import_metadata: { kind: "bank_import" }, db_entry_id: "x", gl_code: SALARIES, debit_credit: "debit", amount: 5000 },
      { import_metadata: null, db_entry_id: "y", gl_code: SALARIES, debit_credit: "debit", amount: 5000 },
    ], { salariesCode: SALARIES });
    expect(h).toEqual([]);
  });

  it("groups a multi-line run into ONE history point, oldest first", () => {
    const h = payrollHistoryFromLedger([
      row({ db_entry_id: "b", date: "2026-05-31", import_metadata: { kind: "payroll", gross: 12100 } }),
      row({ db_entry_id: "a", date: "2026-05-17", import_metadata: { kind: "payroll", gross: 11800 } }),
      row({ db_entry_id: "a", date: "2026-05-17", import_metadata: { kind: "payroll", gross: 11800 }, gl_code: "1000", debit_credit: "credit", amount: 9000 }),
    ], { salariesCode: SALARIES });
    expect(h.map(x => x.gross)).toEqual([11800, 12100]);
  });
});

describe("the auto path and the manual path write the SAME entry", () => {
  const CODES = { salariesCode: "6000", payrollTaxExpCode: "6010", cashCode: "1000", payrollTaxesPayableCode: "2101" };
  const IMP = { source: "Gusto", period: "2026-06-01 – 2026-06-14", pay_date: "2026-06-19", total_gross: 12000, total_net: 9000, total_employer_taxes: 918 };

  it("one builder, one result — the auto post is the manual post", () => {
    // Both PayrollView paths call payrollEntryForImport with the same args, so the
    // strongest functional statement is that the builder is deterministic and its
    // output is what posts. (The structural test below pins that there IS only one.)
    expect(payrollEntryForImport(IMP, CODES)).toEqual(payrollEntryForImport(IMP, CODES));
  });

  it("the entry is balanced and carries the C189 paid stamp", () => {
    const je = payrollEntryForImport(IMP, CODES);
    expect(je.balanced).toBe(true);
    expect(je.meta.payment_status).toBe("paid");
    expect(je.meta.kind).toBe("payroll");
  });

  it("meta carries the figures derived from the posted lines — the next run's norm input", () => {
    const je = payrollEntryForImport(IMP, CODES);
    expect(je.meta.gross).toBe(12000);
    expect(je.meta.net).toBe(9000);
    expect(je.meta.withholdings).toBe(3000);
    expect(je.meta.employer_taxes).toBe(918);
    // and that stamped gross is exactly what the history reader picks up next time
    const back = payrollHistoryFromLedger(
      [{ import_metadata: je.meta, db_entry_id: "e", date: IMP.pay_date, gl_code: "6000", debit_credit: "debit", amount: 12000 }],
      { salariesCode: "6000" });
    expect(back[0].gross).toBe(12000);
  });

  it("STRUCTURAL — the payroll pipeline has exactly ONE builder call and ONE write call", () => {
    // The spec's hard constraint: auto-post must not grow a parallel posting path.
    //
    // ★ O116 MOVED THIS PIPELINE FROM `PayrollView.jsx` INTO `App.jsx` so the Home queue
    // could run it too, which means the file is no longer the right SCOPE — App.jsx writes
    // many kinds of entry. Naively repointing made this read the whole file and demand ONE
    // `persistMultiLineEntry` in a file that legitimately has eight: **a repointed test that
    // now asserts something else is worse than a failing one.** So it is scoped to the
    // payroll region and the assertion is unchanged.
    const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
    const from = app.indexOf("const handlePayrollFile = async (file)");
    const to = app.indexOf("const routeFileToType", from);
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const src = app.slice(from, to);
    expect(src.match(/payrollEntryForImport\(/g) || []).toHaveLength(1);
    expect(src.match(/persistMultiLineEntry\(/g) || []).toHaveLength(1);
    expect(src).not.toMatch(/buildPayrollEntry\(/);          // no second builder
    expect(src).not.toMatch(/post_journal_entry/);           // no direct RPC
    // And the view it moved OUT of must not have grown a copy.
    const view = fs.readFileSync(path.join(process.cwd(), "src/components/views/PayrollView.jsx"), "utf8");
    expect(view).not.toMatch(/persistMultiLineEntry\(/);
  });
});

describe("payrollAutoPostNarration — the owner hears an outcome, not an entry", () => {
  it("names the period, the net and the headcount", () => {
    const msg = payrollAutoPostNarration({ periodLabel: "2026-06-01 – 2026-06-14", net: 9000, headcount: 4 });
    expect(msg).toBe("Payroll for 2026-06-01 – 2026-06-14 is in your books — $9,000.00 net to 4 people.");
  });

  it("says 'person' for one", () => {
    expect(payrollAutoPostNarration({ periodLabel: "June", net: 2200, headcount: 1 })).toMatch(/to 1 person\./);
  });

  it("carries no accounting jargon in any shape", () => {
    const cases = [
      { periodLabel: "2026-06-01 – 2026-06-14", net: 9000, headcount: 4 },
      { periodLabel: "", net: 0, headcount: 0 },
      { periodLabel: "June", net: 7335, headcount: 12 },       // 7335 bare would trip the GL-code lint
      { periodLabel: "May", net: 1234.56, headcount: 2 },
    ];
    for (const c of cases) {
      const msg = payrollAutoPostNarration(c);
      expect(containsOwnerJargon(msg), `leaked jargon: "${msg}"`).toBe(false);
    }
  });
});

describe("registerFromParsedPayroll — withholdings come from the register, not arithmetic", () => {
  it("reads total_deductions as withholdings (deriving gross−net would make the footing check a tautology)", () => {
    const r = registerFromParsedPayroll({ total_gross: 100, total_net: 75, total_deductions: 25 });
    expect(r.withholdings).toBe(25);
  });

  it("a register that states a WRONG deductions total is caught — it would pass a derived check", () => {
    const parsed = { period_start: "2026-06-01", period_end: "2026-06-14", pay_date: "2026-06-19",
                     total_gross: 12000, total_net: 9000, total_deductions: 2500, total_employer_taxes: 918 };
    const g = payrollAutoPostGate(registerFromParsedPayroll(parsed), HISTORY);
    expect(codesOf(g)).toEqual([PAYROLL_GATE.FOOTS]);
  });

  it("missing fields stay null rather than becoming zero", () => {
    const r = registerFromParsedPayroll({ total_gross: 100 });
    expect(r.withholdings).toBe(null);
    expect(r.employerTax).toBe(null);
    expect(r.periodStart).toBe(null);
  });
});
