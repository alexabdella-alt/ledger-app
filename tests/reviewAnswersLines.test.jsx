import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { addQuestionCards, bankLineQuestionCards, OWNER_ANSWERABLE_REASONS } from "../src/lib/statementQuestions.js";

// C657 — the accountant answers an uncategorised bank line with the owner's question card.
const ex = [
  { kind: "line", id: "sxl_L1", statement_id: "S1", bank_account_id: "K", date: "2026-03-15", amount: -1240, vendor: "Chase", description: "CHASE CREDIT CRD AUTOPAY", reason: "low_confidence", title: "Chase", plain: "We weren't sure how to file this." },
  { kind: "line", id: "sxl_L2", statement_id: "S1", date: "2026-03-16", amount: -500, vendor: "Ace", description: "ACE", reason: "unmatched", title: "Ace", plain: "Couldn't match this to a bill." },
];
describe("★ the Review queue offers to answer a line here", () => {
  // Review renders "Loading your review queue…" until an effect runs, so the condition is read from source.
  const src = readFileSync("src/components/views/ReviewView.jsx", "utf8");
  it("only for a line the app couldn't categorise — not one it couldn't match to a bill (booking it fresh could count a bill twice)", () => {
    expect(src).toMatch(/\{x\.kind === "line" && OWNER_ANSWERABLE_REASONS\.has\(x\.reason\) && \(\s*\n\s*<button data-answer-line=\{x\.id\}/);
    expect([...OWNER_ANSWERABLE_REASONS]).toEqual(["low_confidence"]);
  });
  it("the card it queues is the owner's card, with C655's treatment for a card payoff", () => {
    const [c] = bankLineQuestionCards([ex[0]], { bankAccounts: [{ id: "K", name: "Checking", gl_code: "1000" }], cashCode: "1000" });
    expect([c.heldKind, c.statementLine.lineId]).toEqual(["card", "L1"]);
  });
});
describe("the wiring", () => {
  it("queues the card without repeats, goes Home and opens the questions", () => {
    const src = readFileSync("src/components/views/ReviewView.jsx", "utf8");
    expect(src).toMatch(/setClarificationQueue\(\(prev\) => addQuestionCards\(prev, cards\)\);\s*\n\s*setView && setView\("home"\);\s*\n\s*setTimeout\(\(\) => window\.dispatchEvent\(new CustomEvent\("sc:open-stepper"\)\), 0\);/);
    expect(addQuestionCards([{ id: "a" }], [{ id: "a" }, { id: "b" }]).map((c) => c.id)).toEqual(["a", "b"]);
  });
});
