import { describe, it, expect } from "vitest";
import { classifyTxn } from "../src/lib/txnPresent.js";
import { glIsRevenue, glIsExpense } from "../src/lib/gl.js";

// Regression lock for the DENORMALIZED-FLAG AUDIT (CLAUDE.md §9). Each fixed site derives from
// GL truth, with `type` demoted to a fallback ONLY for legacy rows with no gl_code. The recurring
// failure shape is a SETTLEMENT: a bank-matched A/R collection flattens to gl_code=Cash +
// type="expense" (the `type` lie). These fixtures reproduce it.
const AP = "2000", AR = "1100", CASH = "1000", REV = "4100", EXP = "6800";
const codes = { apCode: AP, arCode: AR };

const collection  = { vendor: "Riverside", gl_code: CASH, gl_name: "Cash", secondary_gl_code: AR, secondary_gl_name: "A/R", amount: 1284, type: "expense", payment_status: null, import_metadata: { kind: "ar_collection", payment_for: "inv1" } };
const payment     = { vendor: "Pixel", gl_code: AP, gl_name: "A/P", secondary_gl_code: CASH, secondary_gl_name: "Cash", amount: 1800, type: "expense", payment_status: null, import_metadata: { kind: "ap_payment", payment_for: "bill1" } };
const openBill    = { vendor: "Meridian", gl_code: EXP, gl_name: "Professional Services", secondary_gl_code: AP, secondary_gl_name: "A/P", amount: 900, type: "expense", payment_status: "unpaid" };
const openInvoice = { vendor: "Northwind", gl_code: REV, gl_name: "Service Revenue", secondary_gl_code: AR, secondary_gl_name: "A/R", amount: 6800, type: "revenue", payment_status: "uncollected" };
const cashExpense = { vendor: "Stripe Fee", gl_code: EXP, gl_name: "Bank Fees", secondary_gl_code: CASH, secondary_gl_name: "Cash", amount: 30, type: "expense", payment_status: null };
const cashRevenue = { vendor: "Walk-in", gl_code: REV, gl_name: "Sales", secondary_gl_code: CASH, secondary_gl_name: "Cash", amount: 200, type: "revenue", payment_status: null };
const legacyNoCode = { vendor: "Legacy", gl_code: null, amount: 100, type: "expense", payment_status: "unpaid" }; // pre-flatten row

// Shared predicate the fixed sites use (BooksView, VendorsView spend/list, TransactionDetailPanel).
const isExpense = i => (i.gl_code ? glIsExpense(i.gl_code) : i.type === "expense");
const isRevenue = i => (i.gl_code ? glIsRevenue(i.gl_code) : i.type === "revenue");

describe("§9 fix — GL-truth expense predicate (VendorsView spend / detail panel): flag demoted", () => {
  it("a real expense (debits 5–8xxx) is an expense", () => {
    expect(isExpense(openBill)).toBe(true);
    expect(isExpense(cashExpense)).toBe(true);
  });
  it("a settlement's stale type='expense' no longer counts as an expense (no vendor double-count)", () => {
    expect(isExpense(collection)).toBe(false);   // gl_code=Cash → not an expense
    expect(isExpense(payment)).toBe(false);       // gl_code=A/P → not an expense (the bill already counted it)
  });
  it("revenue rows are never expenses", () => {
    expect(isExpense(cashRevenue)).toBe(false);
    expect(isExpense(openInvoice)).toBe(false);
    expect(isRevenue(cashRevenue)).toBe(true);
  });
  it("legacy row with NO gl_code falls back to the type flag", () => {
    expect(isExpense(legacyNoCode)).toBe(true);   // fallback path preserved
  });
});

describe("§9 fix — detail-panel sign + Mark-Paid gate come from classifyTxn (settlement-aware)", () => {
  it("collection: sign is money-IN (+) and shows NO 'Mark Paid'", () => {
    const c = classifyTxn(collection, codes);
    expect(c.inflow).toBe(true);            // was shown as red '−' via the type flag
    expect(c.settleAction).toBe(null);       // was wrongly offering 'Mark Paid'
  });
  it("open bill: money-OUT (−) and DOES show 'Mark Paid'", () => {
    const c = classifyTxn(openBill, codes);
    expect(c.inflow).toBe(false);
    expect(c.settleAction).toBe("pay");
  });
  it("payment settlement: money-OUT (−), NO 'Mark Paid'", () => {
    const c = classifyTxn(payment, codes);
    expect(c.inflow).toBe(false);
    expect(c.settleAction).toBe(null);
  });
});

describe("§9 fix — ReconView bookSigned is settlement-aware (correct diff)", () => {
  const bookSigned = i => classifyTxn(i, codes).inflow ? Math.abs(i.amount) : -Math.abs(i.amount);
  it("a collection contributes POSITIVE to the books side (was negative — corrupted the diff)", () => {
    expect(bookSigned(collection)).toBe(1284);
  });
  it("payments and expenses contribute negative; revenue positive", () => {
    expect(bookSigned(payment)).toBe(-1800);
    expect(bookSigned(cashExpense)).toBe(-30);
    expect(bookSigned(cashRevenue)).toBe(200);
    expect(bookSigned(openInvoice)).toBe(6800);
  });
});
