import { describe, it, expect } from "vitest";
import { computeControlTotals, evaluateSignOff } from "../src/lib/controlTotals.js";
import { buildIntakeRow } from "../src/lib/documentIntake.js";
import { trialBalance } from "../src/lib/reports.js";

// ════════════════════════════════════════════════════════════════════════════
// O59 launch-gate #1 — the trust layer's THIRD NET (accuracy control totals) +
// the O50 sign-off gate. Independent cross-foots from GL truth; a mismatch is an
// accuracy flag; sign-off is blocked while any net is unresolved.
// ════════════════════════════════════════════════════════════════════════════

const CODES = { ar: "1100", ap: "2000", salesTax: "2350" };

// A correctly-booked, taxed AR invoice (3-line: Dr A/R 108 / Cr Revenue 100 /
// Cr Sales-Tax-Payable 8), flattened one row per line (id `je_i`), each carrying
// the invoice's captured tax on import_metadata.
const taxedInvoiceCorrect = (je = "jeC", { collected = false } = {}) => ([
  { id: `${je}_0`, gl_code: "1100", amount: 108, debit_credit: "debit",  date: "2026-05-01", type: "revenue", payment_status: collected ? "collected" : "unpaid", import_metadata: { tax_amount: 8 } },
  { id: `${je}_1`, gl_code: "4000", amount: 100, debit_credit: "credit", date: "2026-05-01", type: "revenue", ar_amount: 108, payment_status: collected ? "collected" : "unpaid", import_metadata: { tax_amount: 8 } },
  { id: `${je}_2`, gl_code: "2350", amount: 8,   debit_credit: "credit", date: "2026-05-01", type: "revenue", import_metadata: { tax_amount: 8 } },
]);

// The SAME invoice, mis-booked: the $8 sales tax posted to REVENUE (4000) instead
// of Sales-Tax-Payable (2350) — the Riverside class. High confidence, wrong account,
// STILL balances (Dr 108 = Cr 100 + Cr 8).
const taxedInvoiceRiverside = (je = "jeR") => ([
  { id: `${je}_0`, gl_code: "1100", amount: 108, debit_credit: "debit",  date: "2026-05-01", type: "revenue", payment_status: "unpaid", import_metadata: { tax_amount: 8 } },
  { id: `${je}_1`, gl_code: "4000", amount: 100, debit_credit: "credit", date: "2026-05-01", type: "revenue", ar_amount: 108, payment_status: "unpaid", import_metadata: { tax_amount: 8 } },
  { id: `${je}_2`, gl_code: "4000", amount: 8,   debit_credit: "credit", date: "2026-05-01", type: "revenue", import_metadata: { tax_amount: 8 } },  // ← WRONG account
]);

const findCheck = (r, key) => r.checks.find((c) => c.key === key);

describe("(a) a confidently-WRONG booking (sales tax → revenue) breaks a control total → accuracy flag", () => {
  const r = computeControlTotals({ invoices: taxedInvoiceRiverside(), codes: CODES });
  it("the trial balance STILL ties (wrong-account is still balanced — why we need this net)", () => {
    expect(findCheck(r, "trial_balance").ties).toBe(true);
  });
  it("the sales-tax control does NOT tie ($8 charged, $0 in the liability)", () => {
    const c = findCheck(r, "sales_tax_tie");
    expect(c.ties).toBe(false);
    expect(c.a).toBe(8);   // tax charged on invoices
    expect(c.b).toBe(0);   // sales tax owed (liability) — it went to revenue
  });
  it("surfaces as a high-severity ACCURACY flag with plain-English figures", () => {
    const flag = r.flags.find((f) => f.key === "sales_tax_tie");
    expect(flag.kind).toBe("accuracy");
    expect(flag.severity).toBe("high");
    expect(flag.description).toMatch(/\$8\.00.*\$0\.00|should match but don't/);
    expect(flag.description).not.toMatch(/debit|credit|journal|GL/i);   // Cardinal Principle
  });
  it("the correctly-booked version ties (no false positive)", () => {
    const ok = computeControlTotals({ invoices: taxedInvoiceCorrect(), codes: CODES });
    expect(findCheck(ok, "sales_tax_tie").ties).toBe(true);
    expect(ok.allTie).toBe(true);
    expect(ok.flags).toEqual([]);
  });
});

describe("(e) trial balance: debits === credits ties when balanced, breaks when not", () => {
  it("ties on a balanced fixture", () => {
    const tb = trialBalance(taxedInvoiceCorrect());
    expect(tb.balanced).toBe(true);
    const r = computeControlTotals({ invoices: taxedInvoiceCorrect(), codes: CODES });
    expect(findCheck(r, "trial_balance").ties).toBe(true);
  });
  it("breaks on an unbalanced entry (Dr 100 / Cr 90 — a missing $10 leg)", () => {
    const unbalanced = [
      { id: "bad_0", gl_code: "6000", amount: 100, debit_credit: "debit",  date: "2026-05-01" },
      { id: "bad_1", gl_code: "1000", amount: 90,  debit_credit: "credit", date: "2026-05-01" },
    ];
    const tb = trialBalance(unbalanced);
    expect(tb.balanced).toBe(false);
    const c = findCheck(computeControlTotals({ invoices: unbalanced, codes: CODES }), "trial_balance");
    expect(c.ties).toBe(false);
    expect(Math.abs(c.diff)).toBe(10);
  });
});

describe("AR / AP / docs-recorded / cash-recon control totals", () => {
  it("AR sub-ledger ties to the GL receivables balance for an open invoice", () => {
    const r = computeControlTotals({ invoices: taxedInvoiceCorrect(), codes: CODES });
    const c = findCheck(r, "ar_tie");
    expect(c.a).toBe(108);   // sum of open invoices (incl tax)
    expect(c.b).toBe(108);   // GL A/R balance
    expect(c.ties).toBe(true);
  });
  it("docs-recorded control flags a doc marked booked with NO entry behind it", () => {
    const intakeRows = [
      { id: "d1", status: "recorded", journal_entry_ids: ["je1"] },
      { id: "d2", status: "recorded", journal_entry_ids: [] },   // claimed booked, nothing posted
    ];
    const c = findCheck(computeControlTotals({ invoices: [], intakeRows, codes: CODES }), "docs_recorded");
    expect(c.a).toBe(2); expect(c.b).toBe(1); expect(c.ties).toBe(false);
  });
  it("cash-recon control flags a completed reconciliation whose books ≠ statement", () => {
    const reconciliations = [{ id: "r1", status: "complete", account_name: "Checking", period_end: "2026-05-31", books_balance: 5000, statement_balance: 5000.75 }];
    const c = findCheck(computeControlTotals({ invoices: [], reconciliations, codes: CODES }), "cash_recon");
    expect(c.ties).toBe(false);
    expect(Math.abs(c.diff)).toBe(0.75);
  });
  it("cash-recon NETS stored outstanding items — a completed rec with an uncashed check PASSES (O83 Feb)", () => {
    // The exact Feb scenario: books 20,339.40, statement 20,614.40, one $275 outstanding check
    // (signed −275, money out). Raw books≠statement would false-fail "off by $275" and block
    // sign-off; netting (20,614.40 − 275 = 20,339.40) ties.
    const rec = { id: "feb", status: "complete", account_name: "Primary Checking", period_end: "2026-02-28",
      books_balance: 20339.40, statement_balance: 20614.40,
      outstanding_books: [{ id: "atlas", amount: 275, signed: -275 }], unmatched_bank: [] };
    const c = findCheck(computeControlTotals({ invoices: [], reconciliations: [rec], codes: CODES }), "cash_recon");
    expect(c).toBeDefined();
    expect(c.ties).toBe(true);            // NETS → passes → Feb sign-off unblocked
    expect(c.b).toBe(20339.40);           // the netted bank figure (after the uncashed check)
  });
  it("cash-recon still FAILS a genuinely-off rec even with outstanding netting", () => {
    // Same as above but books are $100 short of the netted bank → real discrepancy, still flagged.
    const rec = { id: "off", status: "complete", account_name: "Checking", period_end: "2026-02-28",
      books_balance: 20239.40, statement_balance: 20614.40,
      outstanding_books: [{ id: "atlas", amount: 275, signed: -275 }], unmatched_bank: [] };
    const c = findCheck(computeControlTotals({ invoices: [], reconciliations: [rec], codes: CODES }), "cash_recon");
    expect(c.ties).toBe(false);
    expect(Math.abs(c.diff)).toBe(100);
  });
  it("cash-recon does NOT emit a (vacuous 0===0) check for a $0 UNVERIFIED phantom (O83)", () => {
    const phantom = [{ id: "p1", status: "complete", account_name: "Checking", period_end: "2026-05-31", books_balance: 0, statement_balance: 0 }];
    const c = findCheck(computeControlTotals({ invoices: [], reconciliations: phantom, codes: CODES }), "cash_recon");
    expect(c).toBeUndefined();   // phantom excluded → no cash_recon check at all
    // an import_snapshot is likewise ignored
    expect(findCheck(computeControlTotals({ invoices: [], reconciliations: [{ ...phantom[0], status: "import_snapshot" }], codes: CODES }), "cash_recon")).toBeUndefined();
    // a VERIFIED $0 (confirmed empty/closed) DOES produce a check (and ties 0===0 legitimately)
    const verified = [{ ...phantom[0], statement_balance_verified: true }];
    expect(findCheck(computeControlTotals({ invoices: [], reconciliations: verified, codes: CODES }), "cash_recon")).toBeDefined();
  });
});

describe("(b)/(c) sign-off gate — clear when all nets clear, BLOCKED otherwise", () => {
  const cleanTotals = computeControlTotals({ invoices: taxedInvoiceCorrect(), codes: CODES });
  it("(b) all three nets clear → sign-off OK, no blockers", () => {
    const r = evaluateSignOff({ controlTotals: cleanTotals, openConfidenceFlags: [], droppedDocs: [], unknownDocs: [] });
    expect(r.ok).toBe(true);
    expect(r.blockers).toEqual([]);
  });
  it("(c) a control total that doesn't tie BLOCKS sign-off with the accuracy reason", () => {
    const dirty = computeControlTotals({ invoices: taxedInvoiceRiverside(), codes: CODES });
    const r = evaluateSignOff({ controlTotals: dirty });
    expect(r.ok).toBe(false);
    expect(r.blockers.map((b) => b.net)).toContain("accuracy");
  });
  it("an unresolved confidence flag (O49) blocks sign-off", () => {
    const r = evaluateSignOff({ controlTotals: cleanTotals, openConfidenceFlags: [{ id: "x" }] });
    expect(r.ok).toBe(false);
    expect(r.blockers.map((b) => b.net)).toContain("confidence");
  });
  it("a dropped document (O60) blocks sign-off", () => {
    const r = evaluateSignOff({ controlTotals: cleanTotals, droppedDocs: [{ id: "d" }] });
    expect(r.ok).toBe(false);
    expect(r.blockers.map((b) => b.net)).toContain("completeness");
  });
});

describe("(d) O60 Phase 2 — a doc arriving via a non-upload path gets an intake record", () => {
  it("buildIntakeRow stamps the source so bank/contract/payroll arrivals are tracked", () => {
    for (const source of ["bank", "contract", "payroll"]) {
      const row = buildIntakeRow({ companyId: "c1", filename: `x.${source}`, source });
      expect(row.source).toBe(source);
      expect(row.status).toBe("received");
      expect(row.company_id).toBe("c1");
    }
  });
});

describe("C189 — posted payroll must stamp payment_status 'paid' (ap_tie control)", () => {
  // A posted-payroll-shaped multi-line entry (flattened rows): Dr Salaries + Dr Payroll Tax
  // Exp, Cr Cash + Cr Payroll Taxes Payable. Gross 4000, employer 306 → gross+employer = 4306
  // (the live ap_tie failure amount). None of the legs touch A/P (2000) — the withholding
  // liability lives in its own GL (2101) — so glAccountBalance('2000') = 0.
  const payrollEntry = (paymentStatus) => {
    const ps = paymentStatus ? { payment_status: paymentStatus } : {};
    return [
      { id: "pje_0", gl_code: "6000", amount: 4000, debit_credit: "debit",  date: "2026-03-15", status: "posted", source: "payroll", ...ps }, // Dr Salaries (gross)
      { id: "pje_1", gl_code: "6010", amount: 306,  debit_credit: "debit",  date: "2026-03-15", status: "posted", source: "payroll", ...ps }, // Dr Payroll Tax Exp (employer)
      { id: "pje_2", gl_code: "1000", amount: 3200, debit_credit: "credit", date: "2026-03-15", status: "posted", source: "payroll", ...ps }, // Cr Cash (net)
      { id: "pje_3", gl_code: "2101", amount: 1106, debit_credit: "credit", date: "2026-03-15", status: "posted", source: "payroll", ...ps }, // Cr Payroll Taxes Payable (withholdings + employer)
    ];
  };

  it("WITH payment_status 'paid' → ap_tie ties (nothing leaks into open bills)", () => {
    const r = computeControlTotals({ invoices: payrollEntry("paid"), codes: CODES });
    const c = findCheck(r, "ap_tie");
    expect(c.ties).toBe(true);
    expect(c.a).toBe(0);   // apSub — no unpaid expense legs
    expect(c.b).toBe(0);   // apGl — A/P (2000) untouched by payroll
  });

  it("WITHOUT payment_status → ap_tie FAILS by exactly gross + employer (locks the bug signature)", () => {
    const r = computeControlTotals({ invoices: payrollEntry(null), codes: CODES });
    const c = findCheck(r, "ap_tie");
    expect(c.ties).toBe(false);
    expect(c.a).toBe(4306);            // both expense legs leak into "open bills"
    expect(c.b).toBe(0);
    expect(Math.abs(c.diff)).toBe(4306);   // the live $4,306.00 ap_tie failure
  });
});
