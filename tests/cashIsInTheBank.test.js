import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { cashOnHandCodes, glCashOnHand } from "../src/lib/reports.js";
import { flattenJournalEntries } from "../src/lib/ledger.js";

// C666 — a credit card or loan linked as a bank account is not cash.
const ACC = [["1000","Cash"],["1010","Savings Account"],["2200","Credit Card Liability"],["2500","Long-Term Debt"],["6600","Office Supplies"],["3400","Opening Balance Equity"]].map(([code,name])=>({code,name}));
const je = (id, lines, extra = {}) => ({ id, entry_date: "2026-03-10", description: id, status: "posted", deleted_at: null, source: "bank_import", created_at: "2026-03-10T10:00:00Z",
  journal_entry_lines: lines.map((l,n)=>({ id:`${id}-${n}`, debit:l[1], credit:l[2], accounts:{ code:l[0], name: ACC.find(a=>a.code===l[0]).name } })), ...extra });
const rows = flattenJournalEntries([
  je("open", [["1000",5000,0],["3400",0,5000]], { source: "opening_balance" }),
  je("supplies on card", [["6600",1240,0],["2200",0,1240]]),
], ACC);

describe("★ cash on hand counts what is in the bank", () => {
  it("only asset accounts are cash", () => expect(cashOnHandCodes(["1000", "1010", "2200", "2500", "1000"])).toEqual(["1000", "1010"]));
  it("★ $1,240 owed on the card is not added to $5,000 in the bank", () => {
    expect(glCashOnHand(rows, ["1000", "2200"])).toBe(6240);                  // the bug: the old set
    expect(glCashOnHand(rows, cashOnHandCodes(["1000", "2200"]))).toBe(5000); // the fix
  });
  it("the app's cash set is filtered; the matcher and Review keep the cards (a card payment is a payment)", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/const cashGlCodes = useMemo\(\(\) => cashOnHandCodes\(paymentSourceGlCodes\), \[paymentSourceGlCodes\]\);/);
    expect(app).toMatch(/planInvoiceArrival\(invoice, arrivalLedger, \{\s*\n\s*cashCodes: paymentSourceGlCodes,/);
  });
});
