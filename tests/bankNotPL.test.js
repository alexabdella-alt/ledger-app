import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { notProfitAndLossKind, holdNotProfitAndLoss, NOT_PL_REASON } from "../src/lib/bankNotPL";
import { planStatementPipeline } from "../src/lib/pipeline";

// C651 — a bank line whose own words say it isn't income or spending is held, not auto-booked.
const L = (description, extra = {}) => ({ description, vendor: "", amount: 500, confidence: 92, needs_review: false, gl_code: "6500", type: "expense", ...extra });

describe("which statement lines are not profit or loss", () => {
  it.each([
    ["CHASE CREDIT CRD AUTOPAY 031526", "card"], ["AMEX EPAYMENT ACH PMT", "card"], ["CAPITAL ONE ONLINE PMT", "card"],
    ["DISCOVER E-PAYMENT 4421", "card"], ["PAYMENT TO CREDIT CARD 1234", "card"], ["CITI CARD ONLINE PAYMENT", "card"],
    ["OWNER DRAW", "owner"], ["Owners draw - March", "owner"], ["MEMBER DISTRIBUTION", "owner"],
    ["SBA LOAN PMT", "loan"], ["LOAN PAYMENT 0042", "loan"], ["WELLS FARGO MORTGAGE", "loan"], ["LOAN PROCEEDS", "loan"],
    ["ONLINE TRANSFER TO SAVINGS XXXXXX1234", "transfer"], ["ONLINE TRANSFER FROM CHK 5521", "transfer"],
    ["INTERNAL TRANSFER", "transfer"], ["TRANSFER TO CHECKING 8812", "transfer"], ["MOBILE XFER FROM SAV", "transfer"],
  ])("★ %s → %s", (d, kind) => expect(notProfitAndLossKind(L(d))).toBe(kind));

  it.each([
    ["ZELLE TRANSFER FROM JOHN SMITH"], ["ONLINE TRANSFER VIA ZELLE FROM JOHN SMITH"], ["WIRE TRANSFER FROM 48211"], ["VENMO TRANSFER"], ["WIRE TRANSFER FROM ACME CORP"], ["PAYPAL TRANSFER"],
    ["TOAST POS DEPOSIT 011326"], ["SYSCO FOODS ACH"], ["HOME DEPOT #123"], ["COMCAST CABLE"], ["MERCHANT FEES JAN"],
    ["SQ *CORNER CAFE"], ["CHASE BANK SERVICE FEE"], ["DISCOVERY CHILDRENS MUSEUM"], ["OWNERSHIP SOLUTIONS LLC"],
  ])("ordinary lines are left alone: %s", (d) => expect(notProfitAndLossKind(L(d))).toBe(null));
});

describe("the hold", () => {
  it("★ a held line needs review, sits below the auto-book floor, and says why in plain words", () => {
    const [h] = holdNotProfitAndLoss([L("AMEX EPAYMENT ACH PMT")]);
    expect([h.needs_review, h.confidence <= 50, h.not_pl, h.reasoning]).toEqual([true, true, "card", NOT_PL_REASON.card]);
  });
  it("★ through the real pipeline: held → an exception for a person, never booked", () => {
    const lines = holdNotProfitAndLoss([L("ONLINE TRANSFER TO SAVINGS", { id: "a" }), L("SYSCO FOODS", { id: "b" })]);
    const r = planStatementPipeline({ lines });
    expect(r.toBook.map((x) => x.id)).toEqual(["b"]);
    expect(r.exceptions.map((e) => [e.lineId, e.reason])).toEqual([["a", "low_confidence"]]);
  });
  it("a vendor rule the owner made wins", () => {
    const [h] = holdNotProfitAndLoss([L("OWNER DRAW", { rule_applied: true, confidence: 99 })]);
    expect([h.needs_review, h.confidence]).toEqual([false, 99]);
  });
  it("★ wired into BOTH bank paths, after the vendor rules", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app.match(/const withRules = holdNotProfitAndLoss\(categorized\.map\(/g)).toHaveLength(2);
  });
  it("every reason is plain: no accounting words", async () => {
    const { OWNER_JARGON_RE } = await import("../src/lib/clarify.js");
    for (const r of Object.values(NOT_PL_REASON)) expect(r).not.toMatch(OWNER_JARGON_RE);
  });
});

// C652 — the held line's question says what it looks like.
import { bankLineQuestionCards, heldQuestion } from "../src/lib/statementQuestions";
import { OWNER_JARGON_RE } from "../src/lib/clarify.js";
describe("the held line's question", () => {
  const cards = bankLineQuestionCards([
    { kind: "line", id: "sxl_1", statement_id: "S", date: "2026-03-15", amount: -1240, vendor: "CHASE CREDIT CRD AUTOPAY", description: "CHASE CREDIT CRD AUTOPAY 031526", reason: "low_confidence" },
    { kind: "line", id: "sxl_2", statement_id: "S", date: "2026-03-16", amount: 2000, vendor: "Savings", description: "ONLINE TRANSFER FROM SAV 5521", reason: "low_confidence" },
    { kind: "line", id: "sxl_3", statement_id: "S", date: "2026-03-17", amount: -84.12, vendor: "Home Depot", description: "HOME DEPOT #123", reason: "low_confidence" },
  ], { cashCode: "1000" });
  it("★ a card payoff is asked as a card payoff, not 'what was this for?'", () => {
    expect(cards[0].question).toBe("The $1,240.00 to CHASE CREDIT CRD AUTOPAY looks like paying off a credit card, which isn't new spending, so it hasn't been recorded. If it was something else, say what it was for.");
  });
  it("★ money moved in from savings is asked as a transfer, not as a sale", () => {
    expect(cards[1].question).toMatch(/^The \$2,000\.00 from Savings looks like money moved between your own accounts/);
  });
  it("an ordinary line keeps its ordinary question", () => {
    expect(heldQuestion(cards[2].invoice)).toBe(null);
    expect(cards[2].question).toMatch(/what was the \$84\.12 payment to Home Depot/i);
  });
  it("plain words (our words — the bank's own text in the vendor name is the bank's)", () => {
    for (const c of cards) expect(c.question.replace(c.invoice.vendor, "")).not.toMatch(OWNER_JARGON_RE);
  });
});
