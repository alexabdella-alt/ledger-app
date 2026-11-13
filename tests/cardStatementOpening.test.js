import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { deriveStatementOpening, chronologicalStatementRows } from "../src/lib/openingBalanceProposal.js";

// C668 — a credit card's statement counts what is owed: a purchase raises the balance.
const card = [
  { date: "2026-03-02", amount: 100, type: "charge", balance: 1100 },
  { date: "2026-03-05", amount: 40, type: "charge", balance: 1140 },
  { date: "2026-03-20", amount: 500, type: "credit", balance: 640 },
];
describe("★ a card statement's opening and ending", () => {
  it("from the running balance: $1,000 owed before a $100 purchase that took it to $1,100", () => {
    const d = deriveStatementOpening({ transactions: card, liability: true });
    expect([d.derived, d.endingBalance]).toEqual([1000, 640]);
  });
  it("the bank-sign reading it replaces got $1,200", () => {
    expect(deriveStatementOpening({ transactions: card }).derived).toBe(1200);
  });
  it("★ a correct printed 'previous balance' is not a mismatch any more", () => {
    expect(deriveStatementOpening({ transactions: card, statedOpening: 1000, liability: true }).mismatch).toBe(false);
  });
  it("no running balance: ending = opening + purchases − payments", () => {
    const rows = card.map(({ balance, ...r }) => r);
    expect(deriveStatementOpening({ transactions: rows, statedOpening: 1000, liability: true }).endingBalance).toBe(640);
  });
  it("newest-first card exports are put back in order by the card's own balance chain", () => {
    expect(chronologicalStatementRows(card.slice().reverse(), { liability: true }).map((r) => r.date)).toEqual(["2026-03-02", "2026-03-05", "2026-03-20"]);
  });
  it("★ rows all on one date are ordered by the CARD's balance chain (only the chain can tell)", () => {
    const sameDay = card.map((r) => ({ ...r, date: "2026-03-02" })).reverse();
    expect(chronologicalStatementRows(sameDay, { liability: true }).map((r) => r.balance)).toEqual([1100, 1140, 640]);
  });
  it("a bank statement is unchanged", () => {
    const bank = [{ date: "2026-03-02", amount: 100, type: "debit", balance: 900 }];
    expect(deriveStatementOpening({ transactions: bank }).derived).toBe(1000);
  });
  it("both bank-import callers pass the account's kind", () => {
    expect(readFileSync("src/App.jsx", "utf8").match(/deriveStatementOpening\(\{ transactions: rawTxns, statedOpening, statedPeriodStart, liability: isCardAccount\(account\) \}\)/g)).toHaveLength(2);
  });
});
