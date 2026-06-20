import { describe, it, expect } from "vitest";
import { planApBackfill, planArBackfill } from "../src/lib/apBackfill.js";
import { glAccountBalance } from "../src/lib/reports.js";

const AP = "2000", CASH = "1000", EXP = "6500", CUTOFF = "2025-01-01";

// A paid bill booked to AP (Dr Expense / Cr AP), pre-Step-1 (no payment JE).
const bill = (id, date, amount, over = {}) => ({
  id, status: "posted", deleted_at: null, source: "manual", payment_status: "paid",
  entry_date: date, paid_at: `${date}T12:00:00Z`, import_metadata: null,
  ap_credit: amount, ap_account_code: AP, ...over,
});

// Convert a planned backfill entry to the flattened-ledger shape glAccountBalance reads.
// NB: id must NOT contain "_" (that marks a multi-line expansion → offset leg skipped).
const toFlat = (e, i) => ({
  id: `bfx${i}`, date: e.date, amount: e.amount, debit_credit: "debit",
  gl_code: e.lines[0].code, secondary_gl_code: e.lines[1].code, status: "booked",
});

describe("planApBackfill — selects exactly the pre-Step-1 paid AP bills", () => {
  const entries = [
    bill("b1", "2025-03-01", 300),                                            // candidate
    bill("b2", "2025-04-01", 200),                                            // candidate
    { id: "payX", status: "posted", source: "manual", payment_status: "paid", entry_date: "2025-05-01",
      import_metadata: { kind: "ap_payment", payment_for: "x" }, ap_credit: 0, ap_account_code: AP }, // a payment JE itself → skip (kind)
    // bill already paid via Step 1 (a payment JE links to it) → skip b4
    bill("b4", "2025-06-01", 150),
    { id: "pay4", status: "posted", source: "manual", payment_status: null, entry_date: "2025-06-02",
      import_metadata: { kind: "ap_payment", payment_for: "b4" }, ap_credit: 0, ap_account_code: AP },
    bill("c1", "2025-07-01", 90, { ap_credit: 0 }),                           // direct-to-cash (no AP credit) → skip
    bill("pre", "2024-12-01", 400),                                          // pre-cutoff → skip (opening balances)
    bill("ob", "2025-02-01", 1000, { source: "opening_balance" }),           // opening entry → skip
    bill("unpaid", "2025-08-01", 75, { payment_status: "unpaid" }),          // unpaid → skip
    { id: "void", status: "voided", source: "manual", payment_status: "paid", entry_date: "2025-03-15",
      import_metadata: null, ap_credit: 999, ap_account_code: AP },           // voided → skip
  ];
  const plan = planApBackfill(entries, { cashCode: CASH, cutoffDate: CUTOFF });

  it("picks only the genuine pre-Step-1 paid AP bills (b1, b2)", () => {
    expect(plan.entries.map(e => e.billId).sort()).toEqual(["b1", "b2"]);
    expect(plan.billCount).toBe(2);
    expect(plan.total).toBe(500);
  });
  it("each entry is a balanced Dr AP / Cr Cash for the bill amount", () => {
    for (const e of plan.entries) {
      expect(e.lines).toEqual([
        { code: AP, debit: e.amount, credit: 0 },
        { code: CASH, debit: 0, credit: e.amount },
      ]);
      const d = e.lines.reduce((s, l) => s + l.debit, 0), c = e.lines.reduce((s, l) => s + l.credit, 0);
      expect(d).toBe(c);                                   // balances
    }
  });
  it("dates use paid_at, floored at the cutoff; links back to the bill (backfill:true)", () => {
    const b1 = plan.entries.find(e => e.billId === "b1");
    expect(b1.date).toBe("2025-03-01");
    expect(b1.meta).toEqual({ kind: "ap_payment", payment_for: "b1", backfill: true });
  });
  it("touches no P&L account (net income untouched)", () => {
    const pl = c => ["4", "5", "6", "7", "8"].includes(String(c)[0]);
    expect(plan.entries.every(e => e.lines.every(l => !pl(l.code)))).toBe(true);
  });
});

describe("planApBackfill — reduces GL AP to ap_before − total, and is idempotent", () => {
  // Original ledger: two AP bills (Dr Exp / Cr AP), both flagged paid pre-Step-1.
  const flatBill = (id, amt) => ({ id, date: "2025-03-01", amount: amt, debit_credit: "debit", gl_code: EXP, secondary_gl_code: AP, status: "booked" });
  const ledger = [flatBill("b1", 300), flatBill("b2", 200)];
  const dbEntries = [bill("b1", "2025-03-01", 300), bill("b2", "2025-03-01", 200)];

  it("resulting GL AP === ap_before − total_backfill", () => {
    const apBefore = glAccountBalance(AP, ledger);               // 300 + 200 = 500
    expect(apBefore).toBe(500);
    const plan = planApBackfill(dbEntries, { cashCode: CASH, cutoffDate: CUTOFF });
    const withBackfill = [...ledger, ...plan.entries.map(toFlat)];
    const apAfter = glAccountBalance(AP, withBackfill);
    expect(apAfter).toBe(apBefore - plan.total);                 // 500 − 500 = 0
    expect(glAccountBalance(CASH, withBackfill)).toBe(-plan.total);   // Cash reduced by the same
  });

  it("re-running after the backfill posts NOTHING (bills now have a payment JE)", () => {
    const plan = planApBackfill(dbEntries, { cashCode: CASH, cutoffDate: CUTOFF });
    // Simulate the posted backfill entries (now linked to their bills) being in the ledger.
    const posted = plan.entries.map((e, i) => ({
      id: `bf_${i}`, status: "posted", deleted_at: null, source: "manual", payment_status: null,
      entry_date: e.date, paid_at: null, import_metadata: e.meta, ap_credit: -e.amount, ap_account_code: AP,
    }));
    const rerun = planApBackfill([...dbEntries, ...posted], { cashCode: CASH, cutoffDate: CUTOFF });
    expect(rerun.entries).toEqual([]);                          // idempotent
    expect(rerun.total).toBe(0);
  });
});

const AR = "1100";
// A collected invoice booked to A/R (Dr A/R / Cr Revenue), pre-collection-posting.
const inv = (id, date, amount, over = {}) => ({
  id, status: "posted", deleted_at: null, source: "sent_invoice", payment_status: "collected",
  entry_date: date, paid_at: `${date}T12:00:00Z`, import_metadata: null,
  ar_debit: amount, ar_account_code: AR, ...over,
});
const toFlatAr = (e, i) => ({
  id: `arbf${i}`, date: e.date, amount: e.amount, debit_credit: "debit",
  gl_code: e.lines[0].code, secondary_gl_code: e.lines[1].code, status: "booked",
});

describe("planArBackfill — collected invoices that never posted Dr Cash / Cr A/R", () => {
  const entries = [
    inv("i1", "2025-03-01", 500),                                              // candidate
    inv("i2", "2025-04-01", 250),                                              // candidate
    inv("i4", "2025-06-01", 400),                                             // already-collected (link below) → skip
    { id: "col4", status: "posted", source: "manual", payment_status: null, entry_date: "2025-06-02",
      import_metadata: { kind: "ar_collection", payment_for: "i4" }, ar_debit: 0, ar_account_code: AR },
    inv("cash1", "2025-07-01", 90, { ar_debit: 0 }),                          // cash sale (no A/R) → skip
    inv("pre", "2024-12-01", 800),                                           // pre-cutoff → skip
    inv("ob", "2025-02-01", 1000, { source: "opening_balance" }),            // opening → skip
    inv("open", "2025-08-01", 75, { payment_status: "uncollected" }),        // not collected → skip
  ];
  const plan = planArBackfill(entries, { cashCode: CASH, cutoffDate: CUTOFF });

  it("picks only the genuine pre-posting collected A/R invoices (i1, i2)", () => {
    expect(plan.entries.map(e => e.invoiceId).sort()).toEqual(["i1", "i2"]);
    expect(plan.invoiceCount).toBe(2);
    expect(plan.total).toBe(750);
  });
  it("each entry is a balanced Dr Cash / Cr A/R, linked back to the invoice", () => {
    for (const e of plan.entries) {
      expect(e.lines).toEqual([{ code: CASH, debit: e.amount, credit: 0 }, { code: AR, debit: 0, credit: e.amount }]);
      expect(e.meta).toEqual({ kind: "ar_collection", payment_for: e.invoiceId, backfill: true });
    }
  });
  it("reduces GL A/R to ar_before − total; Cash increases by the same", () => {
    const ledger = [
      { id: "i1", date: "2025-03-01", amount: 500, debit_credit: "debit", gl_code: AR, secondary_gl_code: "4000", status: "booked" },
      { id: "i2", date: "2025-04-01", amount: 250, debit_credit: "debit", gl_code: AR, secondary_gl_code: "4000", status: "booked" },
    ];
    const arBefore = glAccountBalance(AR, ledger);        // 750 (debit-normal asset)
    expect(arBefore).toBe(750);
    const withBackfill = [...ledger, ...plan.entries.map(toFlatAr)];
    expect(glAccountBalance(AR, withBackfill)).toBe(arBefore - plan.total);   // 0
    expect(glAccountBalance(CASH, withBackfill)).toBe(plan.total);            // Cash +750
  });
  it("clean data → no-op (nothing to backfill), and re-running posts nothing", () => {
    expect(planArBackfill([], { cashCode: CASH, cutoffDate: CUTOFF }).entries).toEqual([]);
    const posted = plan.entries.map((e, i) => ({
      id: `arbf${i}`, status: "posted", deleted_at: null, source: "manual", payment_status: null,
      entry_date: e.date, paid_at: null, import_metadata: e.meta, ar_debit: -e.amount, ar_account_code: AR,
    }));
    expect(planArBackfill([...entries, ...posted], { cashCode: CASH, cutoffDate: CUTOFF }).entries).toEqual([]);
  });
});
