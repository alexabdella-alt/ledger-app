import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { openReceivables, receivableEntries } from "../src/lib/receivables.js";

// ═════════════════════════════════════════════════════════════════════════════
// C452 — "STILL OWED TO YOU" ON THE CUSTOMERS SCREEN COUNTED MONEY ALREADY IN THE BANK.
// A direct deposit (Dr Cash / Cr Revenue) has no payment_status, so the flag rule read it
// as owed. One definition now — the A/R-leg rule — read by ArView and CustomersView.
// ═════════════════════════════════════════════════════════════════════════════
const AR = "1100", CASH = "1000", REV = "4010";
const deposit = { id: "d1", vendor: "Acme", amount: 500, date: "2026-09-01", gl_code: REV, secondary_gl_code: CASH, type: "revenue", status: "booked", source: "bank_import" };
const invoice = { id: "i1", vendor: "Acme", amount: 700, date: "2026-09-01", gl_code: REV, secondary_gl_code: AR, type: "revenue", status: "booked", source: "ar_invoice" };
const collected = { ...invoice, id: "i2", payment_status: "collected" };
const collection = { id: "s1", vendor: "Acme", amount: 700, date: "2026-09-10", gl_code: CASH, secondary_gl_code: AR, type: "revenue", status: "booked", source: "manual", import_metadata: { kind: "ar_collection", payment_for: "i1" } };

describe("openReceivables", () => {
  it("a direct deposit is never owed; an issued invoice is; a collected one and the collection itself are not", () => {
    expect(openReceivables([deposit], AR)).toEqual([]);
    expect(openReceivables([invoice], AR).map((i) => i.id)).toEqual(["i1"]);
    expect(openReceivables([collected], AR)).toEqual([]);
    expect(openReceivables([collection], AR)).toEqual([]);
    expect(receivableEntries([invoice, collected, deposit], AR)).toHaveLength(2);
  });
  it("without an A/R code the answer is nothing, never a guess", () => {
    expect(openReceivables([invoice], null)).toEqual([]);
  });
  it("★ the owed figure is the taxed receivable (ar_amount), not the ex-tax revenue row (C454)", () => {
    const src = fs.readFileSync("src/components/views/CustomersView.jsx", "utf8");
    expect(src).toMatch(/openReceivables\(txns, arRoleCode\)\.reduce\(\(s,i\)=>s\+owedAmount\(i\),0\)/);
    expect(src).toMatch(/openReceivables\(custInvoices, arRoleCode\)\.filter\(.*?\)\.reduce\(\(s,i\)=>s\+owedAmount\(i\),0\)/);
  });
  it("both screens read it", () => {
    const cust = fs.readFileSync("src/components/views/CustomersView.jsx", "utf8");
    const ar = fs.readFileSync("src/components/views/ArView.jsx", "utf8");
    expect(cust).toMatch(/const openARfor = txns => openReceivables\(txns, arRoleCode\)/);
    expect(cust).not.toMatch(/payment_status!=="collected"&&i\.payment_status!=="paid"\)\.reduce/);
    expect(ar).toMatch(/const arOpen\s+= openReceivables\(invoices, arRoleCode\);/);
    expect(ar).toMatch(/const arAll\s+= receivableEntries\(invoices, arRoleCode\);/);
  });
});
