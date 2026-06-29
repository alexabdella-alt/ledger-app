import { describe, it, expect } from "vitest";
import { clearedOriginal, clearingSettlement } from "../src/lib/settlementLink.js";

// An A/P bill (Dr Expense / Cr A/P) and the payment that cleared it (Dr A/P / Cr Cash).
const bill = { id: "row-bill", db_entry_id: "JE-100", vendor: "Pixel Contractor", amount: -1800, date: "2026-02-10", gl_code: "6800", secondary_gl_code: "2000" };
const payment = { id: "row-pay", db_entry_id: "JE-200", vendor: "Pixel Contractor", amount: 1800, date: "2026-03-01",
  import_metadata: { kind: "ap_payment", payment_for: "JE-100" } };

// An A/R invoice (Dr A/R / Cr Revenue) and the collection that cleared it (Dr Cash / Cr A/R).
const invoice = { id: "row-inv", db_entry_id: "JE-300", vendor: "Acme Co", amount: 5000, date: "2026-02-15", gl_code: "4000", secondary_gl_code: "1100" };
const collection = { id: "row-coll", db_entry_id: "JE-400", vendor: "Acme Co", amount: 5000, date: "2026-04-02",
  import_metadata: { kind: "ar_collection", payment_for: "JE-300" } };

const all = [bill, payment, invoice, collection];

describe("clearedOriginal — settlement → the original it cleared", () => {
  it("a payment resolves to its A/P bill (with vendor/amount/noun/id to navigate)", () => {
    const r = clearedOriginal(payment, all);
    expect(r).toMatchObject({ kind: "ap_payment", docNoun: "bill", id: "row-bill", vendor: "Pixel Contractor", amount: 1800, date: "2026-02-10" });
  });
  it("a collection resolves to its A/R invoice", () => {
    const r = clearedOriginal(collection, all);
    expect(r).toMatchObject({ kind: "ar_collection", docNoun: "invoice", id: "row-inv", vendor: "Acme Co", amount: 5000 });
  });
  it("returns null for a non-settlement entry (the bill itself)", () => {
    expect(clearedOriginal(bill, all)).toBeNull();
  });
  it("returns null when the original isn't loaded", () => {
    expect(clearedOriginal(payment, [payment])).toBeNull();
  });
  it("returns null when a settlement has no payment_for", () => {
    expect(clearedOriginal({ id: "x", import_metadata: { kind: "ap_payment" } }, all)).toBeNull();
  });
});

describe("clearingSettlement — original → the settlement that cleared it", () => {
  it("a bill resolves to its payment (reverse direction)", () => {
    const r = clearingSettlement(bill, all);
    expect(r).toMatchObject({ kind: "ap_payment", actionNoun: "payment", id: "row-pay", amount: 1800, date: "2026-03-01" });
  });
  it("an invoice resolves to its collection", () => {
    const r = clearingSettlement(invoice, all);
    expect(r).toMatchObject({ kind: "ar_collection", actionNoun: "collection", id: "row-coll", amount: 5000 });
  });
  it("returns null for an unsettled original (no clearing entry present)", () => {
    const openBill = { id: "row-open", db_entry_id: "JE-999", vendor: "Nobody", amount: -50 };
    expect(clearingSettlement(openBill, all)).toBeNull();
  });
  it("a settlement is not itself 'settled by' something → null", () => {
    expect(clearingSettlement(payment, all)).toBeNull();
  });
});

describe("round-trip: the two directions point at each other", () => {
  it("bill → payment → bill", () => {
    const fwd = clearingSettlement(bill, all);      // bill → payment
    const back = clearedOriginal(all.find(i => i.id === fwd.id), all);  // payment → bill
    expect(back.id).toBe(bill.id);
  });
});
