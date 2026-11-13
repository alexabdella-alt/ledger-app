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
  it("both reconcile paths use ONE rule — the ledger code — for 'this account counts what is owed' (C670)", () => {
    expect(readFileSync("src/App.jsx", "utf8")).toMatch(/reconcileDifference\(\{ statementBalance: stmtEnding, booksBalance, outstandingSigned, unmatchedBankSigned: 0, liability: owedAccount\(account\) \}\)/);
    expect(readFileSync("src/components/views/ReconView.jsx", "utf8")).toMatch(/const owed = owedAccount\(reconAcct\);[\s\S]{0,300}liability: owed \}\);/);
  });
});

// C670 — the review's findings.
import { owedAccount, openingGapExplainedCount } from "../src/lib/reconcile.js";
import { openingMismatchCopy } from "../src/lib/workbench.js";
import { deriveStatementOpening } from "../src/lib/openingBalanceProposal.js";
describe("★ C670 — one rule, the opening gap, and card 'payment' rows", () => {
  it("'owed' is decided by the ledger code (how the books figure is signed)", () => {
    expect([owedAccount({ gl_code: "2200" }), owedAccount({ type: "credit_card", gl_code: "1000" }), owedAccount({ type: "loan", gl_code: "2500" }), owedAccount(null)]).toEqual([true, false, true, false]);
  });
  it("★ a card's opening gap from an unposted $50 purchase IS explained (statement opens $50 below what the books owe)", () => {
    const cands = [{ signed: -50 }];
    expect(openingGapExplainedCount(cands, -50, { liability: true })).toBe(1);
    expect(openingGapExplainedCount(cands, -50)).toBe(0);   // the bank test it replaces
  });
  it("a bank's uncashed $50 check still explains a statement opening $50 higher", () => {
    expect(openingGapExplainedCount([{ signed: -50 }], 50)).toBe(1);
  });
  it("the card says purchases, not checks", () => {
    expect(openingMismatchCopy({ diff: -50, explainedCount: 1, accountName: "Business card", liability: true })).toBe("Business card: the $50.00 difference is explained by 1 purchase that hasn't shown up on the card statement yet ✓");
    expect(openingMismatchCopy({ diff: 50, explainedCount: 1, accountName: "Checking" })).toMatch(/1 check you wrote/);
  });
  it("★ on a card's own statement a row typed 'payment' is money onto the card", () => {
    const rows = [{ date: "2026-03-02", amount: 100, type: "charge" }, { date: "2026-03-20", amount: 600, type: "payment" }];
    expect(deriveStatementOpening({ transactions: rows, statedOpening: 1000, liability: true }).endingBalance).toBe(500);
  });
  it("Reconcile does not suggest income for money onto a card; both opening-gap checks use the shared rule", () => {
    const rv = readFileSync("src/components/views/ReconView.jsx", "utf8");
    expect(rv).toMatch(/const noSuggestion = owed && Number\(t\.amount\) > 0;/);
    expect(rv).toMatch(/\{!noSuggestion && <button onClick=\{\(\)=>addToBooks\(t,gl\)\}/);
    expect(rv).toMatch(/return openingGapExplainedCount\(cands, openingMismatch\.diff, \{ liability: owed \}\);/);
    expect(readFileSync("src/components/views/BankView.jsx", "utf8")).toMatch(/openingGapExplainedCount\(cands, openingDiscrepancyFlag\.diff, \{ liability: owedAccount\(importAccount\) \}\)/);
  });
});
