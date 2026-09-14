// ─────────────────────────────────────────────────────────────────────────────
// C365 — A QUESTION ASKED IN AN EARLIER SITTING SURVIVES A RELOAD.
//
// The clarification card is React state (O121). A document the pipeline declined to book
// because it needed an answer left its intake row HELD "awaiting clarification" — TERMINAL,
// so the completeness net never chased it — and after a reload the card was gone, the
// header counted zero open questions, and the document sat unbooked with nothing on any
// screen to say so. The row is the record; this reads it, counts it, and offers the way back.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CLARIFICATION_HOLD_DETAIL, heldQuestionRows, heldQuestionsCopy } from "../src/lib/waitingOnYou.js";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import DashboardView from "../src/components/views/DashboardView.jsx";

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const row = (over = {}) => ({ id: "r1", status: "held_for_review", detail: CLARIFICATION_HOLD_DETAIL, filename: "sysco-aug.pdf", document_id: "d1", received_at: "2026-09-01T00:00:00Z", ...over });

describe("heldQuestionRows reads the durable record", () => {
  it("a held-for-a-question row with no live card is a held question", () => {
    const out = heldQuestionRows([row()]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "question_held", intake_id: "r1", filename: "sysco-aug.pdf", reloadable: true, loading: false });
  });
  it("a row whose card is still on screen is NOT counted again (the queue counts it)", () => {
    expect(heldQuestionRows([row()], { liveIntakeIds: ["r1"] })).toHaveLength(0);
  });
  it("only the clarification hold, by its exact sentence — a payroll hold or a stash is not a question", () => {
    expect(heldQuestionRows([row({ detail: "payroll register held for a person: it doesn't foot" })])).toHaveLength(0);
    expect(heldQuestionRows([row({ detail: "awaiting clarification in review queue — extra" })])).toHaveLength(0);
    expect(heldQuestionRows([row({ status: "recorded" })])).toHaveLength(0);
  });
  it("no stored file → not reloadable; a re-read in flight → loading", () => {
    expect(heldQuestionRows([row({ document_id: null })])[0].reloadable).toBe(false);
    expect(heldQuestionRows([row()], { uploadQueue: [{ id: 9, intake_id: "r1", status: "processing" }] })[0].loading).toBe(true);
    expect(heldQuestionRows([row()], { uploadQueue: [{ id: 9, intake_id: "r1", status: "done" }] })[0].loading).toBe(false);
  });
  it("the sentence reads the rows — count, and whether the file is still there to ask again", () => {
    expect(heldQuestionsCopy(heldQuestionRows([row()]))).toBe("1 document from earlier is still waiting for an answer from you — it isn't in your books until you answer.");
    expect(heldQuestionsCopy(heldQuestionRows([row(), row({ id: "r2", document_id: null })]))).toMatch(/2 documents from earlier .* 1 of them would need to be dropped again/);
    expect(heldQuestionsCopy(heldQuestionRows([row({ document_id: null })]))).toMatch(/no longer have the file/);
    expect(heldQuestionsCopy([])).toBe("");
  });
});

describe("the wiring", () => {
  const app = read("src/App.jsx");
  it("the hold path writes the constant the reader matches on — one string, not two", () => {
    expect(app).toMatch(/markIntake\(item\.intake_id, INTAKE_STATUS\.HELD, \{ detail: CLARIFICATION_HOLD_DETAIL \}\)/);
    expect(app).not.toMatch(/detail: "awaiting clarification in review queue"/);
  });
  it("the trust header counts held questions beside the in-session cards", () => {
    expect(app).toMatch(/openClarifications: \(clarificationQueue \|\| \[\]\)\.length \+ heldQuestions\.length/);
    expect(app).toMatch(/const heldQuestions = useMemo\(\(\) => \{[\s\S]{0,400}heldQuestionRows\(intakeRows, \{ liveIntakeIds, uploadQueue \}\)/);
  });
  it("the live ids come from the cards' own upload items, so an on-screen question is never counted twice", () => {
    const i = app.indexOf("const heldQuestions = useMemo(");
    expect(app.slice(i, i + 500)).toMatch(/\.map\(c => \(uploadQueue \|\| \[\]\)\.find\(q => q\.id === c\.queueItemId\)\?\.intake_id\)/);
  });
});

describe("Home renders the card, and the button only where a file exists to re-read", () => {
  const ctx = (heldQuestions) => ({ ...POPULATED, ...VIEW_CONTEXT["DashboardView.jsx"], heldQuestions });
  const strip = (h) => h.replace(/<!-- -->/g, "").replace(/&#x27;/g, "'");
  // ★ The fixture's upload queue is EMPTY — the state after a reload. The first placement of
  // this card sat inside `{uploadQueue.length > 0 && …}` and this probe found it: rendered
  // nothing, precisely when the card is needed (C321's locked room). Keep the queue empty here.
  it("a reloadable held question shows the sentence and the button — with NO upload queue on screen", () => {
    expect((POPULATED.uploadQueue || []).length).toBe(0);
    const html = strip(renderViewHtml(DashboardView, ctx(heldQuestionRows([row()]))));
    expect(html).toContain("1 document from earlier is still waiting for an answer from you");
    expect(html).toContain("Bring the questions back");
  });
  it("a held question with no stored file shows the sentence and NO button (O124: no control that fails on click)", () => {
    const html = strip(renderViewHtml(DashboardView, ctx(heldQuestionRows([row({ document_id: null })]))));
    expect(html).toContain("no longer have the file");
    expect(html).not.toContain("Bring the questions back");
  });
  it("nothing held → nothing rendered", () => {
    const html = strip(renderViewHtml(DashboardView, ctx([])));
    expect(html).not.toContain("waiting for an answer from you");
  });
});
