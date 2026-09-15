import { describe, it, expect } from "vitest";
import fs from "fs";
import { partialHoldDetail, parsePartialHold, heldPartialRows, heldPartialCopy, ANSWER_NOT_LANDED_DETAIL } from "../src/lib/waitingOnYou.js";
import { settleIntakeAfterAnswers, ANSWER_OUTCOME } from "../src/lib/clarificationSettle.js";
import { buildStashDetail } from "../src/lib/statementLifecycle.js";
import { homeWaitingList } from "../src/lib/homeWaiting.js";
import { ownerTrustState } from "../src/lib/ownerTrust.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ═════════════════════════════════════════════════════════════════════════════
// C390 — A DOCUMENT ONLY PARTLY IN THE BOOKS HAS A SCREEN AFTER A RELOAD. C311 wrote
// "1 of 3 transaction(s) saved — 2 did not…" to a terminal HELD row and nothing read it:
// the trust panel said "everything you sent is accounted for" over a file two-thirds
// missing, and no card anywhere offered to finish it.
// ═════════════════════════════════════════════════════════════════════════════
const row = (over = {}) => ({ id: "in1", status: "held_for_review", filename: "hill-country.pdf", document_id: "doc1", detail: partialHoldDetail(1, 3), ...over });

describe("★★ writer and reader share one sentence", () => {
  it("the sentence the writer stores is the sentence the reader parses", () => {
    expect(parsePartialHold(partialHoldDetail(1, 3))).toEqual({ saved: 1, expected: 3, missing: 2, afterAnswer: false });
    expect(parsePartialHold(partialHoldDetail(0, 1))).toEqual({ saved: 0, expected: 1, missing: 1, afterAnswer: false });
    expect(parsePartialHold("awaiting clarification in review queue")).toBeNull();
    expect(parsePartialHold("2 of 3 transactions saved")).toBeNull();   // a near-miss spelling is NOT a partial hold
  });
  it("App's HELD site writes through partialHoldDetail, not a second spelling", () => {
    const app = fs.readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/INTAKE_STATUS\.HELD, \{\s*journalEntryIds: entryLinks\.ids,\s*detail: partialHoldDetail\(entryLinks\.ids\.length, entryLinks\.expected\)/);
    expect(app).not.toMatch(/did not, so this document is not fully recorded/);
  });
});

describe("★ the reader", () => {
  it("lists a partial hold with its counts, reloadable when the bytes are stored", () => {
    const rows = heldPartialRows([row(), row({ id: "in2", document_id: null }), row({ id: "in3", detail: "something else" }), row({ id: "in4", status: "recorded" })]);
    expect(rows.map((r) => [r.intake_id, r.saved, r.expected, r.missing, r.reloadable])).toEqual([["in1", 1, 3, 2, true], ["in2", 1, 3, 2, false]]);
  });
  it("a row whose tile is on screen this session is not doubled; an in-flight reload shows as loading", () => {
    expect(heldPartialRows([row()], { uploadQueue: [{ id: "q1", intake_id: "in1", status: "done" }] })).toEqual([]);
    expect(heldPartialRows([row()], { uploadQueue: [{ id: "q1", intake_id: "in1", status: "processing" }] })[0].loading).toBe(true);
  });
  it("the copy names the file and the counts, in the owner's words", () => {
    const one = heldPartialCopy(heldPartialRows([row()]));
    expect(one).toContain("hill-country.pdf");
    expect(one).toContain("1 of 3");
    expect(containsOwnerJargon(one)).toBe(false);
    const many = heldPartialCopy(heldPartialRows([row(), row({ id: "in2" })]));
    expect(many).toMatch(/^2 documents/);
  });
});

describe("★★ it reaches Home and the trust panel", () => {
  it("Home carries a NOW item with a reload action for the reloadable rows", () => {
    const items = homeWaitingList({ heldPartial: heldPartialRows([row(), row({ id: "in2", document_id: null })]) });
    const it_ = items.find((i) => i.id === "held_partial");
    expect(it_).toBeTruthy();
    expect(it_.actions[0]).toMatchObject({ kind: "reload", intakeIds: ["in1"] });
  });
  it("the trust panel cannot read 'accounted for' over a partly-recorded file", () => {
    const base = { intakeRows: [{ id: "x", status: "recorded", received_at: "2026-09-01T00:00:00Z" }], completenessChecked: true, hasBooks: true, setupComplete: true };
    const ok = ownerTrustState({ ...base, heldPartial: 0 });
    const held = ownerTrustState({ ...base, heldPartial: 1 });
    expect(held.lines.captured.state).not.toBe("ok");
    expect(held.lines.captured.ok).toBe(false);          // the completeness NET, not only the line's state
    expect(held.nets.completeness).toBe(false);
    expect(ok.nets.completeness).toBe(true);
    expect(held.lines.captured.text).toMatch(/only partly in your books/);
    expect(ok.lines.captured.text).not.toMatch(/only partly/);
  });
});

// C391 — two more holds that a person had to deal with and nothing listed after a reload.
describe("★ C391 — the answer-path hold and the stashed statement reach a reader", () => {
  it("clarificationSettle's 'did not land' row is the constant heldPartialRows reads, with its own sentence", () => {
    const r = settleIntakeAfterAnswers({ outcomes: [{ kind: ANSWER_OUTCOME.BOOKED, jeId: null }], existingIds: [], remainingCards: 0 });
    expect(r.detail).toBe(ANSWER_NOT_LANDED_DETAIL);
    const rows = heldPartialRows([row({ detail: r.detail })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].afterAnswer).toBe(true);
    const copy = heldPartialCopy(rows);
    expect(copy).toMatch(/You answered our question about hill-country\.pdf/);
    expect(containsOwnerJargon(copy)).toBe(false);
  });
  it("a statement stashed for the accountant counts against the trust panel's Documents line", () => {
    const app = fs.readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/heldForAccountant: [^\n]*pendingStatementStashes\(intakeRows\)\.length/);
    const base = { intakeRows: [{ id: "s1", status: "held_for_review", document_id: "d", detail: buildStashDetail({ fileName: "jan.pdf" }), received_at: "2026-09-01T00:00:00Z" }], completenessChecked: true, hasBooks: true, setupComplete: true };
    expect(ownerTrustState({ ...base, heldForAccountant: 1 }).nets.completeness).toBe(false);
  });
});

