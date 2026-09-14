// ─────────────────────────────────────────────────────────────────────────────
// C374 — THE QUESTIONS COME TO THE OWNER, ONE AT A TIME, IN THE MIDDLE OF THE SCREEN.
//
// Operator's call (2026-09-14), reconciling O120's "which cards earn an interruption" with
// C264's "ordering, not interrupting": the stepper opens ONCE when a batch has finished and
// questions remain, walks them in urgency order, and closing it loses nothing. The panel is
// rendered here; the open/close rules (effects, which renderToString never runs) are pinned
// as structure.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { renderToString } from "react-dom/server";
import { ERPContext } from "../src/components/ERPContext";
import { emptyERPContext } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import { StepperPanel } from "../src/components/ClarificationFlow.jsx";
import { sortByUrgency } from "../src/lib/cardUrgency.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

const inv = { id: "i1", vendor: "Hill Country Milling", amount: 468.5, date: "2026-08-06", gl_code: "5010", gl_name: "Food Cost", description: "flour", confidence: 55 };
const lifecycle = { id: "c1", invoice: inv, isLifecycle: true, arrival: { reason: "amount_differs" }, candidateEntry: { amount: 486.5, date: "2026-08-04", description: "Hill Country – ACH DEBIT", vendor: "Hill Country Milling" } };
const gl = { id: "c7", invoice: { ...inv, questions: [{ field: "business_purpose", question: "What was this for?", options: ["Office/Operations", "A specific project"] }] } };
const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const render = (el) => renderToString(React.createElement(ERPContext.Provider, { value: emptyERPContext({ ...POPULATED, clarificationQueue: [gl, lifecycle] }) }, el));

describe("the panel", () => {
  it("shows one card, its position, Skip and Later, and says nothing is lost", () => {
    const open = sortByUrgency([gl, lifecycle]);
    const html = render(React.createElement(StepperPanel, { current: open[0], open }));
    const t = text(html);
    expect(html).toMatch(/role="dialog"/);
    expect(t).toContain("Question 1 of 2");
    expect(t).toContain("Next question");
    expect(t).toContain("Later");
    expect(t).toContain("nothing is lost");
    expect(t).not.toMatch(/undefined|\bNaN\b|\[object Object\]/);
    expect(t.split(/(?<=[.?!])\s+/).filter((s) => containsOwnerJargon(s))).toEqual([]);
  });
  it("the dangerous card comes first (C264's order is kept, not replaced)", () => {
    const open = sortByUrgency([gl, lifecycle]);
    expect(open[0].id).toBe("c1");
    const t = text(render(React.createElement(StepperPanel, { current: open[0], open })));
    expect(t).toMatch(/same purchase|already recorded|payment/i);
  });
  it("the last open card offers no Next — there is nowhere to go (the card's own Skip stays)", () => {
    const t = text(render(React.createElement(StepperPanel, { current: gl, open: [gl] })));
    expect(t).toContain("Question 1 of 1");
    expect(t).not.toContain("Next question");
  });
});

describe("the open/close rules (source)", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/components/ClarificationFlow.jsx"), "utf8").replace(/\/\/[^\n]*/g, "");
  const body = src.slice(src.indexOf("export function ClarificationStepper()"), src.indexOf("export function StepperPanel("));
  it("opens only when the upload queue is idle and this SET of cards was not closed", () => {
    expect(body).toMatch(/const queueIdle = !\(uploadQueue \|\| \[\]\)\.some\(q => q && \(q\.status === "pending" \|\| q\.status === "classifying" \|\| q\.status === "processing"\)\)/);
    expect(body).toMatch(/if \(queueIdle && dismissedKey !== setKey\) setVisible\(true\)/);
    expect(body).toMatch(/const setKey = open\.map\(c => String\(c\.id\)\)\.sort\(\)\.join\("\|"\)/);
  });
  it("closing remembers the set; a new card is a new set", () => {
    expect(body).toMatch(/const close = \(\) => \{ setDismissedKey\(setKey\); setVisible\(false\); \}/);
  });
  it("it is mounted on Home beside the list, not instead of it", () => {
    const home = fs.readFileSync(path.join(process.cwd(), "src/components/views/DashboardView.jsx"), "utf8");
    expect(home).toMatch(/<ClarificationStepper \/>\s*<ClarificationFlow \/>/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★★★ AND THE FIND: C264's "dangerous first" never fired on a real card. `urgencyOf` read
// `kind|type|reason|field`; the pipeline writes `isLifecycle`/`isDuplicate`/`directionFirst`.
// Pinned from the REAL shapes — copied from App.jsx's own pushes, and a source guard holds
// App.jsx to those flags so the reader cannot drift from the writer again.
// ─────────────────────────────────────────────────────────────────────────────
import { urgencyOf, cardKind, URGENCY, queueBannerCopy } from "../src/lib/cardUrgency.js";
describe("★★★ urgency reads the shapes the pipeline actually writes", () => {
  it("a lifecycle, a duplicate and a direction card STOP; a plain category question WAITS", () => {
    expect(urgencyOf({ isLifecycle: true, arrival: { reason: "amount_differs" }, invoice: inv })).toBe(URGENCY.STOPS);
    expect(urgencyOf({ isLifecycle: true, arrival: { reason: "record_failed" }, invoice: inv })).toBe(URGENCY.STOPS);
    expect(urgencyOf({ isDuplicate: true, existingInvoice: {}, invoice: inv })).toBe(URGENCY.STOPS);
    expect(urgencyOf({ directionFirst: true, question: "?", options: [], invoice: inv })).toBe(URGENCY.STOPS);
    expect(urgencyOf({ gaap: true, invoice: inv })).toBe(URGENCY.WAITS);
    expect(urgencyOf({ invoice: inv, questions: [] })).toBe(URGENCY.WAITS);
    expect(cardKind({ invoice: inv })).toBe("gl");
  });
  it("the banner names a stopping kind for a real lifecycle card (it never could before)", () => {
    expect(queueBannerCopy([lifecycle, gl])).toBe("1 needs an answer before we can record it correctly, and 1 that can wait.");
  });
  it("App.jsx builds its cards with exactly the flags the reader keys on", () => {
    const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
    for (const flag of ["isLifecycle: true", "isDuplicate: true", "directionFirst: true"]) expect(app, flag).toContain(flag);
    const reader = fs.readFileSync(path.join(process.cwd(), "src/lib/cardUrgency.js"), "utf8");
    for (const flag of ["card.isLifecycle", "card.isDuplicate", "card.directionFirst"]) expect(reader, flag).toContain(flag);
  });
});
