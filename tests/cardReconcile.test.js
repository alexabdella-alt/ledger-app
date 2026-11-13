import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { reconcileDifference } from "../src/lib/reconcile.js";

// C669 — a card's reconciliation with an uncleared purchase.
describe("★ reconciling a credit card with something not yet on the statement", () => {
  // Statement says $1,000 owed; the books also have a $50 purchase the card hasn't posted: books owe $1,050.
  it("an uncleared $50 purchase ties exactly", () => {
    expect(reconcileDifference({ statementBalance: 1000, booksBalance: 1050, outstandingSigned: -50, liability: true })).toBe(0);
  });
  it("the bank formula it replaces was off by twice the item", () => {
    expect(reconcileDifference({ statementBalance: 1000, booksBalance: 1050, outstandingSigned: -50 })).toBe(-100);
  });
  it("a card line not yet in the books (a $20 purchase on the statement only): the difference is that line", () => {
    expect(reconcileDifference({ statementBalance: 1020, booksBalance: 1000, unmatchedBankSigned: -20, liability: true })).toBe(0);
  });
  it("a bank account is unchanged", () => {
    expect(reconcileDifference({ statementBalance: 1000, booksBalance: 950, outstandingSigned: -50 })).toBe(0);
  });
  it("both reconcile paths tell it the account's kind", () => {
    expect(readFileSync("src/App.jsx", "utf8")).toMatch(/reconcileDifference\(\{ statementBalance: stmtEnding, booksBalance, outstandingSigned, unmatchedBankSigned: 0, liability: isCardAccount\(account\) \}\)/);
    expect(readFileSync("src/components/views/ReconView.jsx", "utf8")).toMatch(/liability: !!reconAcct && \(reconAcct\.type === "credit_card"/);
  });
});
