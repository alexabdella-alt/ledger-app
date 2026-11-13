import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderViewHtml } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import ClarificationFlow from "../src/components/ClarificationFlow.jsx";
import { bankLineQuestionCards } from "../src/lib/statementQuestions.js";
import { CLIENT_VIEW_IDS } from "../src/lib/nav.js";
import { OWNER_JARGON_RE } from "../src/lib/clarify.js";

// C655 — a held bank line's card offers the operator's chosen treatment.
const text = (h) => h.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const owner = { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS };
const CHART = [
  { code: "1000", name: "Cash", system_role: "cash" }, { code: "1010", name: "Savings", system_role: "savings" },
  { code: "2200", name: "Credit Card Liability", system_role: "credit_card_liability" }, { code: "2600", name: "Notes Payable", system_role: "notes_payable" },
  { code: "3300", name: "Owner's Draw / Distributions", system_role: "owners_draw" }, { code: "8000", name: "Interest Expense", system_role: "interest_expense" },
];
const checking = { id: "K", name: "Checking", type: "checking", gl_code: "1000" };
const savings = { id: "S", name: "Savings", type: "savings", gl_code: "1010" };
const card = { id: "C", name: "Business card", type: "credit_card", gl_code: "2200" };
const render = (line, bankAccounts = [checking, savings, card]) => {
  const cards = bankLineQuestionCards([{ kind: "line", id: "sxl_1", statement_id: "S1", bank_account_id: "K", date: "2026-03-15", reason: "low_confidence", ...line }], { bankAccounts, cashCode: "1000" });
  return text(renderViewHtml(ClarificationFlow, { ...POPULATED, navSeat: owner, bankAccounts, CHART_OF_ACCOUNTS: CHART,
    getAccountByRole: (r) => CHART.find((a) => a.system_role === r) || null, companySettings: { legalForm: "sole_prop" }, clarificationQueue: cards }));
};

describe("★ a held line offers to record it", () => {
  it("a card payoff from checking, one card on file", () => {
    const t = render({ amount: -1240, vendor: "Chase", description: "CHASE CREDIT CRD AUTOPAY" });
    expect(t).toMatch(/Was this paying off Business card\? Yes — a card payment/);
  });
  it("a card payoff with no card set up asks the owner to add it", () => {
    expect(render({ amount: -1240, vendor: "Chase", description: "CHASE CREDIT CRD AUTOPAY" }, [checking, savings]))
      .toMatch(/Add this credit card under Settings → Your business → Bank accounts first/);
  });
  it("a transfer in from savings", () => {
    expect(render({ amount: 2000, vendor: "Savings", description: "ONLINE TRANSFER FROM SAV 5521" })).toMatch(/Was this money moved from Savings\? Yes — a move between my accounts/);
  });
  it("an owner draw", () => {
    expect(render({ amount: -500, vendor: "Owner", description: "OWNER DRAW" })).toMatch(/Was this money you took out for yourself\? Yes — money I took out/);
  });
  it("a loan payment asks how much was interest", () => {
    expect(render({ amount: -850, vendor: "SBA", description: "SBA LOAN PMT" })).toMatch(/How much of the \$850\.00 was interest\?/);
  });
  it("loan money received", () => {
    expect(render({ amount: 10000, vendor: "Bank", description: "LOAN PROCEEDS" })).toMatch(/Was this money the business borrowed\? Yes — it's a loan/);
  });
  it("an ordinary line gets no panel — and keeps the income/spending switch", () => {
    const t = render({ amount: -84.12, vendor: "Home Depot", description: "HOME DEPOT #123" });
    expect(t).not.toMatch(/Yes — /);
    expect(t).toMatch(/Wrong type\?/);
  });
  it("★ C656 — a held line has no 'This is income / This is spending' switch: it is neither", () => {
    expect(render({ amount: -1240, vendor: "Chase", description: "CHASE CREDIT CRD AUTOPAY" })).not.toMatch(/Wrong type\?/);
  });
  it("plain words (ours, not the bank's)", () => {
    for (const d of ["CHASE CREDIT CRD AUTOPAY", "ONLINE TRANSFER FROM SAV 5521", "OWNER DRAW", "SBA LOAN PMT"]) {
      const t = render({ amount: -100, vendor: "X", description: d }).replace(d, "");
      expect(t).not.toMatch(OWNER_JARGON_RE);
    }
  });
});

describe("the wiring", () => {
  const flow = readFileSync("src/components/ClarificationFlow.jsx", "utf8");
  const panel = readFileSync("src/components/HeldLinePanel.jsx", "utf8");
  it("★ a typed answer on a bank line opens the treatment instead of refusing (C649/C650 still refuse on a document)", () => {
    expect(flow).toMatch(/if \(bankLine && notIncome !== "refund"\) \{ setFreeError\(null\); setHeldKind\(notIncome\); return; \}/);
    expect(flow).toMatch(/if \(notExpense && !!item\.statementLine && typeof inv\.money_in === "boolean"\) \{ setFreeError\(null\); setHeldKind\(notExpense\); return; \}/);
  });
  it("★ a move already recorded from the other statement is linked, never recorded twice", () => {
    expect(panel).toMatch(/const jeId = existing \|\| await persistMultiLineEntry\(plan\.entry\);/);
  });
  it("★ the line is stamped with the entry and the card settled; what's said is read from the entry", () => {
    expect(panel).toMatch(/settleStatementLine\?\.\(\{ \.\.\.sl, jeId \}\);/);
    expect(panel).toMatch(/heldLineOutcome\(plan\.entry, kindOf, fmtMoney, plan\)/);
  });
});
