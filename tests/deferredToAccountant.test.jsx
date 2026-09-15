// ─────────────────────────────────────────────────────────────────────────────
// C370 — "SET ASIDE FOR YOUR ACCOUNTANT" NOW HAS AN ACCOUNTANT-SIDE SCREEN.
//
// The lifecycle card's defer answer books nothing and leaves the intake row HELD with a
// sentence (C367) that promised the accountant would decide — and gave the accountant no
// screen. Review reads the row; its button re-reads the stored file so the same question
// reaches the reviewer. One string, owned by the reader and imported by the writer.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { waitingOnYou, waitingCopy, deferredToAccountantCards, DEFERRED_DETAIL, CLARIFICATION_HOLD_DETAIL } from "../src/lib/waitingOnYou.js";
import { CLARIFICATION_DEFERRED_DETAIL } from "../src/lib/clarificationSettle.js";

const row = (over = {}) => ({ id: "r1", status: "held_for_review", detail: DEFERRED_DETAIL, filename: "roma-0819.pdf", document_id: "d1", ...over });

describe("the writer and the reader share one sentence", () => {
  it("clarificationSettle writes exactly what waitingOnYou reads", () => {
    expect(CLARIFICATION_DEFERRED_DETAIL).toBe(DEFERRED_DETAIL);
    expect(DEFERRED_DETAIL).not.toBe(CLARIFICATION_HOLD_DETAIL);
  });
});

describe("deferredToAccountantCards", () => {
  it("a deferred row is a card with a reload action; a question or a payroll hold is not", () => {
    const [c] = deferredToAccountantCards([row()]);
    expect(c).toMatchObject({ kind: "deferred_to_accountant", intake_id: "r1", action: "reload", reloadable: true, loading: false });
    expect(deferredToAccountantCards([row({ detail: CLARIFICATION_HOLD_DETAIL })])).toHaveLength(0);
    expect(deferredToAccountantCards([row({ detail: "payroll register held for a person: x" })])).toHaveLength(0);
  });
  it("it rides waitingOnYou beside the payroll and matching cards, and its sentence reads the row", () => {
    const cards = waitingOnYou({ intakeRows: [row()], matchQueue: [], uploadQueue: [] });
    expect(cards.map((c) => c.kind)).toContain("deferred_to_accountant");
    expect(waitingCopy(cards[0])).toBe("roma-0819.pdf was set aside for you after a question the owner couldn't answer — nothing is booked until you decide.");
    expect(waitingCopy(deferredToAccountantCards([row({ document_id: null })])[0])).toMatch(/no longer have the file/);
  });
  it("a re-read in flight is marked loading", () => {
    expect(deferredToAccountantCards([row()], { uploadQueue: [{ id: 1, intake_id: "r1", status: "processing" }] })[0].loading).toBe(true);
  });
});

describe("Review (source) — the screen only paints after an effect resolves, which renderToString never runs (C334's recorded limit), so the wiring is pinned as structure", () => {
  it("the reload branch calls reloadHeldIntake, says a refusal, and offers no button without a file", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/components/views/ReviewView.jsx"), "utf8");
    expect(src).toMatch(/c\.action === "reload"\s*\?\s*\(c\.reloadable && <button disabled=\{c\.loading\} onClick=\{async \(\) => \{ const r = await reloadHeldIntake\(c\.intake_id\); if \(!r\?\.ok\) showNotification/);
    expect(src).toMatch(/waitingOnYou\(\{ intakeRows, matchQueue, uploadQueue \}\)/);
    expect(src).toMatch(/\breloadHeldIntake\b[^\n]*\} = useERP\(\)/);   // C442 appended three keys after it
  });
});
