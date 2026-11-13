import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { notIncomeAnswer, NOT_INCOME_COPY, incomeAccountForAnswer } from "../src/lib/bookingDirection";
import { answerToAccount } from "../src/lib/clarify";
import { moneyInQuestion, bankLineQuestionCards } from "../src/lib/statementQuestions";
import { ACCOUNTS } from "./helpers/populatedFixture.js";

// C649 — money in that the owner says isn't income is never booked as a sale.
describe("what an answer about money IN says", () => {
  it.each([
    ["a refund from Home Depot", "refund"], ["they refunded the deposit", "refund"], ["returned a chair", "refund"],
    ["got reimbursed for supplies", "refund"],
    ["my own money", "owner"], ["I put in some cash", "owner"], ["from my savings", "owner"], ["owner investment", "owner"],
    ["transfer from my personal account", "owner"],
    ["a loan from my brother", "loan"], ["borrowed from the bank", "loan"], ["SBA", "loan"],
    ["transfer from our savings account", "transfer"], ["moved money between my accounts", "transfer"],
  ])("★ %s → %s", (text, kind) => expect(notIncomeAnswer(text)).toBe(kind));

  it.each([["catering for a wedding"], ["a customer paid by wire transfer"], ["we put in an order for a client"], ["consulting work"], ["sold a table"]])(
    "★ a sale stays a sale: %s", (text) => expect(notIncomeAnswer(text)).toBe(null));

  it("the gap this closes: without it, every answer on a money-in card found an income category", () => {
    const getAccountByRole = () => null;
    expect(incomeAccountForAnswer("a loan from my brother", { getAccountByRole, chart: ACCOUNTS })?.gl_code).toMatch(/^4/);
  });
  it("a refund that names what it was for has a spending category to go back to", () => {
    expect(answerToAccount("a refund for supplies", { getAccountByRole: (r) => ACCOUNTS.find((a) => a.system_role === r) || null })).toBeTruthy();
  });
  it("every refusal says it won't be counted as income; none promises a booking", () => {
    for (const k of ["refund_doc", "owner", "loan", "transfer"]) expect(NOT_INCOME_COPY[k]).toMatch(/won't be counted as income/);
    expect(NOT_INCOME_COPY.refund).toMatch(/A refund for what\?/);
  });
});

describe("the card", () => {
  it("★ the wiring: a not-income answer is read BEFORE the income categories, and refuses rather than books", () => {
    const src = readFileSync("src/components/ClarificationFlow.jsx", "utf8");
    const i = src.indexOf('if (inv.type === "revenue") {');
    const block = src.slice(i, i + 1400);
    expect(block.indexOf("notIncomeAnswer(text)")).toBeGreaterThan(-1);
    expect(block.indexOf("notIncomeAnswer(text)")).toBeLessThan(block.indexOf("incomeAccountForAnswer("));
    expect(block).toMatch(/if \(notIncome === "refund" && bankLine\) \{[\s\S]{0,300}glIsExpense\(String\(back\.gl_code\)\)/);
    expect(block).toMatch(/setFreeError\(NOT_INCOME_COPY\[[^\]]+\]\);\s*\n\s*return;/);
  });
  it("the money-in question offers only answers the app can book", () => {
    expect(moneyInQuestion({ amount: 20, vendor: "Home Depot", date: "2026-03-05" }))
      .toBe("What was the $20.00 that came in from Home Depot on Mar 5? (A sale? A refund — and for what? Something else?)");
  });
  it("★ a bank line that came in is asked that question; one that went out keeps the spending question", () => {
    const [out, inn] = bankLineQuestionCards([
      { kind: "line", id: "sxl_A", statement_id: "S", date: "2026-03-02", amount: -84.12, vendor: "Home Depot", reason: "low_confidence" },
      { kind: "line", id: "sxl_B", statement_id: "S", date: "2026-03-05", amount: 20, vendor: "Home Depot", reason: "low_confidence" },
    ], { cashCode: "1000" });
    expect(inn.question).toBe(moneyInQuestion(inn.invoice));
    expect(out.question).toMatch(/what was the \$84\.12 payment to Home Depot/i);
  });
});
