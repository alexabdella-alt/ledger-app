// ─────────────────────────────────────────────────────────────────────────────
// C367 — ANSWERING A QUESTION MOVES THE DOCUMENT'S INTAKE ROW, AND THE CARD'S "✓ BOOKED"
// READS THE WRITE.
//
// The hold path marked a document "awaiting clarification" and nothing ever advanced it:
// an answer booked the entry and the row stayed HELD with that sentence forever. C365 then
// read the sentence back and offered to "bring the question back" for documents whose
// question had been ANSWERED — a category-1 card shipped by the fix for one. And inside the
// card, every booking path fired `bookToDb` unawaited and showed "✓ Booked" regardless.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { settleIntakeAfterAnswers, CLARIFICATION_DEFERRED_DETAIL, ANSWER_OUTCOME } from "../src/lib/clarificationSettle.js";
import { CLARIFICATION_HOLD_DETAIL, heldQuestionRows } from "../src/lib/waitingOnYou.js";
import { INTAKE_STATUS } from "../src/lib/documentIntake.js";

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const B = (jeId) => ({ kind: ANSWER_OUTCOME.BOOKED, jeId });

describe("settleIntakeAfterAnswers — what the row becomes", () => {
  it("nothing settles while another card for the same document is still open", () => {
    expect(settleIntakeAfterAnswers({ outcomes: [B("je1")], remainingCards: 1 }).status).toBeNull();
  });
  it("a booked answer → RECORDED, carrying the ids the batch had already landed", () => {
    const r = settleIntakeAfterAnswers({ outcomes: [B("je9")], existingIds: ["je1", "je2"] });
    expect(r.status).toBe(INTAKE_STATUS.RECORDED);
    expect(r.journalEntryIds).toEqual(["je1", "je2", "je9"]);
    expect(r.detail).toMatch(/3 transaction\(s\) recorded after your answer/);
  });
  it("an attach is backed by the payment's entry (C311) → RECORDED", () => {
    const r = settleIntakeAfterAnswers({ outcomes: [{ kind: ANSWER_OUTCOME.ATTACHED, jeId: "pay1" }] });
    expect(r.status).toBe(INTAKE_STATUS.RECORDED);
    expect(r.journalEntryIds).toEqual(["pay1"]);
  });
  it("anything deferred to the accountant → HELD with a sentence that is NOT a question", () => {
    const r = settleIntakeAfterAnswers({ outcomes: [B("je1"), { kind: ANSWER_OUTCOME.DEFERRED }] });
    expect(r.status).toBe(INTAKE_STATUS.HELD);
    expect(r.detail).toBe(CLARIFICATION_DEFERRED_DETAIL);
    expect(r.journalEntryIds).toEqual(["je1"]);
    // and C365's reader does not mistake it for an open question
    expect(heldQuestionRows([{ id: "r", status: "held_for_review", detail: CLARIFICATION_DEFERRED_DETAIL }])).toHaveLength(0);
    expect(CLARIFICATION_DEFERRED_DETAIL).not.toBe(CLARIFICATION_HOLD_DETAIL);
  });
  it("a claimed booking with NO id is never RECORDED (terminal-and-unlinked is a lie)", () => {
    const r = settleIntakeAfterAnswers({ outcomes: [B(null)] });
    expect(r.status).toBe(INTAKE_STATUS.HELD);
    expect(r.detail).toMatch(/did not land/);
  });
  it("only skips → REJECTED; a skip beside a booking → RECORDED", () => {
    expect(settleIntakeAfterAnswers({ outcomes: [{ kind: ANSWER_OUTCOME.SKIPPED }, { kind: ANSWER_OUTCOME.SKIPPED }] }).status).toBe(INTAKE_STATUS.REJECTED);
    expect(settleIntakeAfterAnswers({ outcomes: [{ kind: ANSWER_OUTCOME.SKIPPED }, B("je1")] }).status).toBe(INTAKE_STATUS.RECORDED);
  });
  it("no outcomes at all settles nothing", () => {
    expect(settleIntakeAfterAnswers({ outcomes: [] }).status).toBeNull();
  });
});

describe("the wiring in App.jsx (source)", () => {
  const app = read("src/App.jsx");
  it("the hold site records the intake row and the ids already landed, keyed by the upload item", () => {
    expect(app).toMatch(/markIntake\(item\.intake_id, INTAKE_STATUS\.HELD, \{ journalEntryIds: entryLinks\.ids, detail: CLARIFICATION_HOLD_DETAIL \}\);/);
    expect(app).toMatch(/clarificationHoldsRef\.current\[String\(item\.id\)\] = \{ intakeId: item\.intake_id, existingIds: entryLinks\.ids \|\| \[\], outcomes: \[\] \}/);
  });
  it("settleClarification counts the OTHER open cards for that upload and plans purely", () => {
    const i = app.indexOf("const settleClarification = (item, outcome) => {");
    const body = app.slice(i, i + 1200);
    expect(body).toMatch(/String\(c\.queueItemId \?\? ""\) === key && !c\.resolved && c\.id !== item\.id/);
    expect(body).toMatch(/const plan = settleIntakeAfterAnswers\(\{ outcomes: hold\.outcomes, existingIds: hold\.existingIds, remainingCards \}\)/);
    expect(body).toMatch(/if \(!plan\.status\) return/);
    expect(body).toMatch(/markIntake\(hold\.intakeId, plan\.status, \{ journalEntryIds: plan\.journalEntryIds, detail: plan\.detail \}\)/);
  });
  it("markIntake updates the in-session snapshot on success — or C365's card would re-offer an answered question", () => {
    const i = app.indexOf("const markIntake = (intakeId, status, opts = {}) => {");
    const body = app.slice(i, i + 900);
    expect(body).toMatch(/if \(!res\.ok\) \{[^}]*return; \}/);
    expect(body).toMatch(/if \(res\.row\) setIntakeRows\(prev =>/);
  });
  it("every applyGaapAnswer branch reports a landed id, and the plain branch is gated on one", () => {
    const i = app.indexOf("const applyGaapAnswer = async (item, opt) => {");
    const body = app.slice(i, app.indexOf("const compensateCapitalization", i));
    expect((body.match(/settleClarification\(item, \{ kind: ANSWER_OUTCOME\.BOOKED, jeId/g) || []).length).toBe(5);
    expect(body).toMatch(/\} else \{\s*if \(!jeId\) return;[\s\S]{0,200}settleClarification\(item, \{ kind: ANSWER_OUTCOME\.BOOKED, jeId \}\);\s*showNotification\(`Booked to \$\{finalInv\.gl_name\} ✓`\)/);
    expect(app).toMatch(/showNotification\(`Recorded as prepaid — spread over \$\{months\} months ✓`\);\s*return capId;/);
    expect(app).toMatch(/showNotification\("Booked as deferred revenue \(advance payment\) ✓"\);\s*return jeId;/);
  });
});

describe("the card (source)", () => {
  const card = read("src/components/ClarificationFlow.jsx");
  it("no booking path fires bookToDb unawaited any more; all four go through bookAnswer", () => {
    expect(card).not.toMatch(/setInvoices\(prev => \[finalInv, \.\.\.prev\]\); bookToDb\(finalInv\);/);
    expect((card.match(/bookAnswer\(finalInv, /g) || []).length).toBe(4);
  });
  it("bookAnswer writes first, gates the success state on the id, and reports the outcome", () => {
    const i = card.indexOf("const bookAnswer = async (finalInv, successText, audit = null) => {");   // C393 added the audit argument
    // comments stripped — a gate commented out still contains its own text (the recorded
    // source-guard escape, eighth time in this repo)
    const body = card.slice(i, i + 900).replace(/\/\/[^\n]*/g, "");
    const w = body.indexOf("const jeId = await bookToDb(finalInv);");
    const g = body.indexOf("if (!jeId) return false;");
    const st = body.indexOf('settleClarification?.(item, { kind: "booked", jeId });');
    const ok = body.indexOf("finishWithSuccess(successText);");
    expect(w).toBeGreaterThan(0); expect(g).toBeGreaterThan(w); expect(st).toBeGreaterThan(g); expect(ok).toBeGreaterThan(st);
  });
  it("every non-booking resolution tells the row what happened before its success state", () => {
    for (const [kind, text] of [["attached", '"Filed with the payment we already recorded"'], ["deferred", '"Set aside for your accountant — nothing booked"'], ["skipped", '"Skipped — duplicate"'], ["skipped", '"Skipped — marked personal"']]) {
      const i = card.indexOf(`finishWithSuccess(${text}`);
      expect(i, text).toBeGreaterThan(0);
      expect(card.slice(i - 260, i)).toMatch(new RegExp(`settleClarification\\?\\.\\(item, \\{ kind: "${kind}"`));
    }
  });
});
