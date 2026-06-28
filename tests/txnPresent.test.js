import { describe, it, expect } from "vitest";
import { classifyTxn, settlementKind, txnStatus } from "../src/lib/txnPresent.js";

const AP = "2000", AR = "1100", CASH = "1000", REV = "4100", EXP = "6800";
const codes = { apCode: AP, arCode: AR };

// Flattened shapes as flattenJournalEntries actually emits them.
const collection = { vendor: "Riverside Cafe", gl_code: CASH, gl_name: "Cash", secondary_gl_code: AR, secondary_gl_name: "Accounts Receivable", debit_credit: "debit", amount: 1284, type: "expense", payment_status: null, import_metadata: { kind: "ar_collection", payment_for: "inv1" } };
const payment    = { vendor: "Pixel", gl_code: AP, gl_name: "Accounts Payable", secondary_gl_code: CASH, secondary_gl_name: "Cash", debit_credit: "debit", amount: 1800, type: "expense", payment_status: null, import_metadata: { kind: "ap_payment", payment_for: "bill1" } };
const openBill   = { vendor: "Meridian", gl_code: EXP, gl_name: "Professional Services", secondary_gl_code: AP, secondary_gl_name: "Accounts Payable", debit_credit: "debit", amount: 900, type: "expense", payment_status: "unpaid" };
const openInvoice= { vendor: "Northwind", gl_code: REV, gl_name: "Service Revenue", secondary_gl_code: AR, secondary_gl_name: "Accounts Receivable", debit_credit: "credit", amount: 6800, type: "revenue", payment_status: "uncollected" };
const cashExpense= { vendor: "Stripe Fee", gl_code: EXP, gl_name: "Bank Fees", secondary_gl_code: CASH, secondary_gl_name: "Cash", debit_credit: "debit", amount: 30, type: "expense", payment_status: null };
const cashRevenue= { vendor: "Walk-in", gl_code: REV, gl_name: "Sales", secondary_gl_code: CASH, secondary_gl_name: "Cash", debit_credit: "credit", amount: 200, type: "revenue", payment_status: null };
const paidBill   = { ...openBill, payment_status: "paid" };

describe("classifyTxn — settlements (the bug): collection = money IN, payment = OUT, no Mark Paid", () => {
  it("Collection (Dr Cash / Cr A/R) → INFLOW (green +), shows the A/R it cleared, NO settle action", () => {
    const c = classifyTxn(collection, codes);
    expect(c.settle).toBe("ar_collection");
    expect(c.inflow).toBe(true);                       // was shown as negative/red — the bug
    expect(c.account).toEqual({ code: AR, name: "Accounts Receivable" }); // not "Cash"
    expect(c.settleAction).toBe(null);                 // already settled — no "Mark Paid"
    expect(txnStatus(collection, c)).toMatchObject({ label: "Received" });
  });
  it("Payment (Dr A/P / Cr Cash) → OUTFLOW (red −), shows A/P, NO settle action", () => {
    const c = classifyTxn(payment, codes);
    expect(c.settle).toBe("ap_payment");
    expect(c.inflow).toBe(false);
    expect(c.account).toEqual({ code: AP, name: "Accounts Payable" });
    expect(c.settleAction).toBe(null);                 // was wrongly offering "Mark Paid"
    expect(txnStatus(payment, c)).toMatchObject({ label: "Paid" });
  });
});

describe("classifyTxn — Mark Paid only on genuinely OPEN items (backwards-logic fix)", () => {
  it("open bill (A/P, unpaid) → settleAction 'pay', status Open", () => {
    const c = classifyTxn(openBill, codes);
    expect(c.settleAction).toBe("pay");
    expect(c.inflow).toBe(false);
    expect(txnStatus(openBill, c)).toMatchObject({ label: "Open" });
  });
  it("open invoice (A/R, uncollected) → settleAction 'collect', INFLOW, status Open", () => {
    const c = classifyTxn(openInvoice, codes);
    expect(c.settleAction).toBe("collect");
    expect(c.inflow).toBe(true);
    expect(txnStatus(openInvoice, c)).toMatchObject({ label: "Open" });
  });
  it("a PAID bill → no settle action, status Paid", () => {
    const c = classifyTxn(paidBill, codes);
    expect(c.settleAction).toBe(null);
    expect(txnStatus(paidBill, c)).toMatchObject({ label: "Paid" });
  });
});

describe("classifyTxn — direct cash entries (no A/R/A/P) are settled, no action", () => {
  it("direct cash expense → OUT, no action, Paid", () => {
    const c = classifyTxn(cashExpense, codes);
    expect(c.inflow).toBe(false); expect(c.settleAction).toBe(null);
    expect(txnStatus(cashExpense, c)).toMatchObject({ label: "Paid" });
  });
  it("direct cash revenue → IN, no action, Received", () => {
    const c = classifyTxn(cashRevenue, codes);
    expect(c.inflow).toBe(true); expect(c.settleAction).toBe(null);
    expect(txnStatus(cashRevenue, c)).toMatchObject({ label: "Received" });
  });
});

describe("settlementKind — kind metadata + description fallback", () => {
  it("reads import_metadata.kind", () => {
    expect(settlementKind(collection)).toBe("ar_collection");
    expect(settlementKind(payment)).toBe("ap_payment");
  });
  it("falls back to the canonical description when only payment_for is set", () => {
    expect(settlementKind({ description: "Collection – Acme", import_metadata: { payment_for: "x" } })).toBe("ar_collection");
    expect(settlementKind({ description: "Payment – Pixel", import_metadata: { payment_for: "y" } })).toBe("ap_payment");
  });
  it("a normal entry is not a settlement", () => {
    expect(settlementKind(openBill)).toBe(null);
  });
});
