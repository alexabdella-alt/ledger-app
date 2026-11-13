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
