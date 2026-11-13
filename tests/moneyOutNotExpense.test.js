import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { notExpenseAnswer, NOT_EXPENSE_COPY } from "../src/lib/bookingDirection";
import { answerToAccount } from "../src/lib/clarify";
import { ACCOUNTS } from "./helpers/populatedFixture.js";

// C650 — money out that the owner says isn't spending is never recorded as a business expense.
const byRole = (r) => ACCOUNTS.find((a) => a.system_role === r) || null;
describe("what an answer about money OUT says", () => {
  it.each([
    ["I paid myself", "owner"], ["owner's draw", "owner"], ["a personal purchase", "owner"], ["not for the business", "owner"],
    ["paid off the credit card", "card"], ["credit card payment", "card"], ["Amex card payment", "card"],
    ["loan payment", "loan"], ["paid back the loan", "loan"], ["SBA", "loan"], ["the mortgage", "loan"],
    ["transfer to savings", "transfer"], ["moved money to my other account", "transfer"],
  ])("★ %s → %s", (text, kind) => expect(notExpenseAnswer(text)).toBe(kind));

  it.each([["office supplies"], ["a client lunch"], ["monthly software"], ["paint to fix up the unit"], ["flour for the kitchen"]])(
    "spending stays spending: %s", (text) => expect(notExpenseAnswer(text)).toBe(null));

  it("★ none of the not-spending answers is placed by the category map — so before C650 every one reached the AI", () => {
    for (const t of ["I paid myself", "paid off the credit card", "loan payment", "transfer to savings"])
      expect(answerToAccount(t, { getAccountByRole: byRole })).toBeFalsy();
  });
  it("every refusal says it won't be recorded as spending", () => {
    for (const k of Object.keys(NOT_EXPENSE_COPY)) expect(NOT_EXPENSE_COPY[k]).toMatch(/won't record it as (one|an expense)/);
  });
});

describe("the card", () => {
  it("★ the check sits after the category map and before the AI, and refuses rather than books", () => {
    const src = readFileSync("src/components/ClarificationFlow.jsx", "utf8");
    const i = src.indexOf("const submitAnswer = ");
    const block = src.slice(i, src.indexOf("const tapChip = ", i));
    const map = block.indexOf("answerToAccount(text,"), check = block.indexOf("notExpenseAnswer(text)"), ai = block.indexOf("interpretFreeText(text)");
    expect(map).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(map);
    expect(ai).toBeGreaterThan(check);
    expect(block).toMatch(/if \(notExpense\) \{ setFreeError\(NOT_EXPENSE_COPY\[notExpense\]\); return; \}/);
  });
});
