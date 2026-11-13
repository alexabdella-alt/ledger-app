// C709 — a statement that READS like a card statement isn't booked to a bank account without asking.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { looksLikeCardStatementContent } from "../src/lib/statementLifecycle.js";

describe("C709 — the lines give a card statement away", () => {
  it("a card's own payment line, interest and fees", () => {
    expect(looksLikeCardStatementContent([{ description: "PAYMENT - THANK YOU", amount: 500 }])).toBe(true);
    expect(looksLikeCardStatementContent([{ description: "AUTOPAY PAYMENT THANK YOU" }])).toBe(true);
    expect(looksLikeCardStatementContent([{ description: "INTEREST CHARGE ON PURCHASES" }])).toBe(true);
    expect(looksLikeCardStatementContent([{ description: "ANNUAL MEMBERSHIP FEE" }])).toBe(true);
  });
  it("a checking statement's lines don't", () => {
    expect(looksLikeCardStatementContent([{ description: "PAYMENT TO CHASE CARD ENDING 1234" }, { description: "ZELLE FROM J SMITH" }, { description: "MONTHLY SERVICE FEE" }, { description: "INTEREST PAYMENT" }])).toBe(false);
    expect(looksLikeCardStatementContent([])).toBe(false);
  });
});

describe("C709 — the drop path stops and asks; an answer is never asked again", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  it("handleBankFile holds before saving or booking — only on a Home drop to a bank account, not after an answer", () => {
    expect(app).toMatch(/if \(callerIntakeId && !accountConfirmed && account && account\.type !== "credit_card" && looksLikeCardStatementContent\(rawTxns\)\) \{/);
    const fn = app.slice(app.indexOf("const handleBankFile = async"));
    expect(fn.indexOf("looksLikeCardStatementContent(rawTxns)")).toBeGreaterThan(0);
    expect(fn.indexOf("looksLikeCardStatementContent(rawTxns)")).toBeLessThan(fn.indexOf("const withRules = holdNotProfitAndLoss("));   // before anything is booked
  });
  it("the statement is stored and held before the question; both answer paths pass accountConfirmed", () => {
    const branch = app.slice(app.indexOf("if (outcome && outcome.cardSuspect) {"), app.indexOf("if (outcome && outcome.cardSuspect) {") + 1600);
    expect(branch.indexOf("storeDocument(")).toBeLessThan(branch.indexOf("statementChoiceFilesRef.current[item.id] = file;"));
    expect(branch).toMatch(/cardHint:true/);
    expect(app).toMatch(/await fileDroppedStatement\(item, file, account, \{ accountConfirmed: true \}\);/);
    expect(app).toMatch(/await handleBankFile\(got\.file, account, \{ intakeId: row\.id, accountConfirmed: true \}\);/);
  });
});
