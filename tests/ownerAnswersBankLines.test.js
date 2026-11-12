import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { bankLineQuestionCards, ownerAnswerableLines, bankLinesWaitingCopy } from "../src/lib/statementQuestions";
import { alignDirectionToAccount } from "../src/lib/bookingDirection";
import { homeWaitingList } from "../src/lib/homeWaiting";

// C641 — an owner with no accountant answers their own uncategorised bank lines.
const exceptions = [
  { kind: "line", id: "sxl_L1", statement_id: "S1", bank_account_id: "B2", date: "2026-03-02", amount: -84.12, vendor: "Home Depot", description: "HOME DEPOT #123", reason: "low_confidence" },
  { kind: "line", id: "sxl_L2", statement_id: "S1", bank_account_id: "B2", date: "2026-03-05", amount: 20, vendor: "Home Depot", description: "HOME DEPOT REFUND", reason: "low_confidence" },
  { kind: "line", id: "sxl_L3", statement_id: "S1", bank_account_id: "B2", date: "2026-03-06", amount: -500, vendor: "Ace", description: "ACE", reason: "unmatched" },
  { kind: "statement", id: "sxs_S1", statement_id: "S1", reason: "balance_discrepancy" },
];
const bankAccounts = [{ id: "B1", name: "Checking", gl_code: "1000" }, { id: "B2", name: "Business card", gl_code: "2100" }];
const ar = { code: "1100", name: "A/R" }, ap = { code: "2000", name: "A/P" };

describe("which lines become questions", () => {
  it("★ only lines the app couldn't categorise — never one it couldn't match to a bill", () => {
    expect(ownerAnswerableLines(exceptions).map((e) => e.id)).toEqual(["sxl_L1", "sxl_L2"]);
  });
  it("each card asks a plain question and carries the line it settles and the account it came from", () => {
    const [c] = bankLineQuestionCards(exceptions, { bankAccounts, cashCode: "1000" });
    expect(c.question).toMatch(/84\.12/);
    expect(c.question).toMatch(/Home Depot/);
    expect(c.statementLine).toEqual({ lineId: "L1", statementId: "S1", accountId: "B2", accountCode: "2100" });
    expect([c.invoice.secondary_gl_code, c.invoice.amount, c.invoice.money_in]).toEqual(["2100", 84.12, false]);
  });
  it("a line whose account is unknown falls back to the main cash account", () => {
    const [c] = bankLineQuestionCards([{ ...exceptions[0], bank_account_id: null }], { bankAccounts, cashCode: "1000", cashName: "Cash" });
    expect(c.invoice.secondary_gl_code).toBe("1000");
  });
});

describe("how an answer is booked", () => {
  const [spend, refund] = bankLineQuestionCards(exceptions, { bankAccounts, cashCode: "1000" });
  it("★ a purchase answered as supplies: Dr Supplies / Cr the card it was paid with", () => {
    const e = alignDirectionToAccount({ ...spend.invoice, gl_code: "6600", gl_name: "Office Supplies" }, { ar, ap });
    expect([e.debit_credit, e.secondary_gl_code]).toEqual(["debit", "2100"]);
  });
  it("★ a REFUND answered as supplies: a credit to supplies (money came in), not a second purchase", () => {
    const e = alignDirectionToAccount({ ...refund.invoice, gl_code: "6600", gl_name: "Office Supplies" }, { ar, ap });
    expect([e.debit_credit, e.secondary_gl_code, e.type]).toEqual(["credit", "2100", "expense"]);
  });
  it("money in answered as a sale: credit to income", () => {
    expect(alignDirectionToAccount({ ...refund.invoice, gl_code: "4100" }, { ar, ap }).debit_credit).toBe("credit");
  });
  it("a document (no statement direction) keeps C591's rule", () => {
    expect(alignDirectionToAccount({ gl_code: "6600", secondary_gl_code: "1000" }, { ar, ap }).debit_credit).toBe("debit");
  });
});

describe("Home", () => {
  it("★ an owner with no accountant is asked; the invite dead end is not shown as well", () => {
    const q = [{ status: "done", type: "bank_statement", result: { needsReview: 2 } }];
    const items = homeWaitingList({ ownerBankLines: 2, hasAccountant: false, cockpit: false, uploadQueue: q });
    expect(items.map((i) => i.id)).toContain("bank_answer");
    expect(items.map((i) => i.id)).not.toContain("bank_review");
    expect(items.find((i) => i.id === "bank_answer").text).toBe(bankLinesWaitingCopy(2));
    expect(items.find((i) => i.id === "bank_answer").actions[0]).toEqual({ kind: "bank_answer", label: "Answer these" });
  });
  it("with an accountant (or on the accountant's seat) nothing changes", () => {
    expect(homeWaitingList({ ownerBankLines: 2, hasAccountant: true, cockpit: false }).map((i) => i.id)).not.toContain("bank_answer");
    expect(homeWaitingList({ ownerBankLines: 2, hasAccountant: false, cockpit: true }).map((i) => i.id)).not.toContain("bank_answer");
  });
  it("★ the wiring: Answer these queues the cards; a booked answer settles its statement line", () => {
    const home = readFileSync("src/components/views/DashboardView.jsx", "utf8");
    expect(home).toMatch(/if \(a\.kind === "bank_answer"\) \{[\s\S]{0,400}setClarificationQueue && setClarificationQueue\(/);
    const flow = readFileSync("src/components/ClarificationFlow.jsx", "utf8");
    expect(flow).toMatch(/settleClarification\?\.\(item, \{ kind: "booked", jeId \}\);\s*\n\s*if \(item\.statementLine\) settleStatementLine\?\.\(item\.statementLine\);/);
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/const settleStatementLine = async \(\{ statementId, accountId = null, accountCode = null \} = \{\}\) => \{/);
    expect(app).toMatch(/await linkStatementLinesAfterBooking\(statementId, acct\); await loadStatementExceptions\(currentCompany\?\.id\);/);
  });
  it("changing the card's type keeps a bank line on its bank account", () => {
    const flow = readFileSync("src/components/ClarificationFlow.jsx", "utf8");
    expect(flow).toMatch(/\.\.\.\(bankLine \? \{\s*\n\s*secondary_gl_code: baseInv\.secondary_gl_code,/);
  });
});
