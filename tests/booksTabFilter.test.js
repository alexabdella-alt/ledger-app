import { describe, it, expect } from "vitest";
import { classifyTxn } from "../src/lib/txnPresent.js";
import { glIsRevenue, glIsExpense } from "../src/lib/gl.js";

// Mirrors the Transactions (BooksView) sub-tab filter predicates. These assert the
// GL-TRUTH classification (CLAUDE.md §9): the account the entry hits decides the tab, NOT the
// denormalized `type` flag — which LIES on settlement entries (an A/R collection flattens to
// gl_code=Cash + type="expense"). Bug fixed: revenue items landed in Expenses, and money-IN
// collections showed a green "+" in Unpaid.
const AP = "2000", AR = "1100", CASH = "1000", REV = "4100", EXP = "6800";
const codes = { apCode: AP, arCode: AR };

const isExpense = i => (i.gl_code ? glIsExpense(i.gl_code) : i.type === "expense");
const isRevenue = i => (i.gl_code ? glIsRevenue(i.gl_code) : i.type === "revenue");
const inTab = (i, filter) => {
  if (filter === "revenue") return isRevenue(i);
  if (filter === "expenses") return isExpense(i);
  if (filter === "unpaid") return classifyTxn(i, codes).settleAction === "pay";
  return true;
};

// Same flattened shapes flattenJournalEntries emits (identical to txnPresent.test.js).
const collection  = { vendor: "Riverside Cafe", gl_code: CASH, gl_name: "Cash", secondary_gl_code: AR, secondary_gl_name: "Accounts Receivable", amount: 1284, type: "expense", payment_status: null, import_metadata: { kind: "ar_collection", payment_for: "inv1" } };
const payment     = { vendor: "Pixel", gl_code: AP, gl_name: "Accounts Payable", secondary_gl_code: CASH, secondary_gl_name: "Cash", amount: 1800, type: "expense", payment_status: null, import_metadata: { kind: "ap_payment", payment_for: "bill1" } };
const openBill    = { vendor: "Meridian", gl_code: EXP, gl_name: "Professional Services", secondary_gl_code: AP, secondary_gl_name: "Accounts Payable", amount: 900, type: "expense", payment_status: "unpaid" };
const openInvoice = { vendor: "Northwind", gl_code: REV, gl_name: "Service Revenue", secondary_gl_code: AR, secondary_gl_name: "Accounts Receivable", amount: 6800, type: "revenue", payment_status: "uncollected" };
const cashExpense = { vendor: "Stripe Fee", gl_code: EXP, gl_name: "Bank Fees", secondary_gl_code: CASH, secondary_gl_name: "Cash", amount: 30, type: "expense", payment_status: null };
const cashRevenue = { vendor: "Walk-in", gl_code: REV, gl_name: "Sales", secondary_gl_code: CASH, secondary_gl_name: "Cash", amount: 200, type: "revenue", payment_status: null };
const paidBill    = { ...openBill, payment_status: "paid" };

describe("Books tabs — Revenue vs Expenses is GL-truth, not the type flag", () => {
  it("a revenue item (credits 4xxx) lands in Revenue and NOT in Expenses", () => {
    expect(inTab(cashRevenue, "revenue")).toBe(true);
    expect(inTab(cashRevenue, "expenses")).toBe(false);
    expect(inTab(openInvoice, "revenue")).toBe(true);
    expect(inTab(openInvoice, "expenses")).toBe(false);
  });
  it("an expense item (debits 5–8xxx) lands in Expenses and NOT in Revenue", () => {
    expect(inTab(openBill, "expenses")).toBe(true);
    expect(inTab(openBill, "revenue")).toBe(false);
    expect(inTab(cashExpense, "expenses")).toBe(true);
    expect(inTab(cashExpense, "revenue")).toBe(false);
  });
  it("a settlement's stale type flag no longer misclassifies it (the leak)", () => {
    // The A/R collection carries type="expense" but hits Cash. OLD rule (|| type) put it in
    // Expenses; GL-truth keeps it out of BOTH P&L tabs (it's a cash movement, not P&L).
    expect(glIsExpense(collection.gl_code) || collection.type === "expense").toBe(true); // old buggy signal
    expect(inTab(collection, "expenses")).toBe(false);                                    // fixed
    expect(inTab(collection, "revenue")).toBe(false);
  });
});

describe("Books tabs — Unpaid = genuinely OPEN bills only (no money-IN '+')", () => {
  it("contains the open bill", () => {
    expect(inTab(openBill, "unpaid")).toBe(true);
  });
  it("excludes the money-IN collection (the reported '+' in Unpaid)", () => {
    expect(inTab(collection, "unpaid")).toBe(false);
    expect(classifyTxn(collection, codes).inflow).toBe(true); // it IS money-in → must not be in Unpaid
  });
  it("excludes payments, paid bills, receivables, and direct-cash expenses", () => {
    expect(inTab(payment, "unpaid")).toBe(false);       // already-settled payment
    expect(inTab(paidBill, "unpaid")).toBe(false);      // paid
    expect(inTab(openInvoice, "unpaid")).toBe(false);   // a receivable (collect), not a bill
    expect(inTab(cashExpense, "unpaid")).toBe(false);   // never a payable
  });
  it("everything in Unpaid is money-OUT (sign audit: never a '+')", () => {
    const all = [collection, payment, openBill, openInvoice, cashExpense, cashRevenue, paidBill];
    for (const i of all.filter(x => inTab(x, "unpaid"))) {
      expect(classifyTxn(i, codes).inflow).toBe(false);
    }
  });
});
