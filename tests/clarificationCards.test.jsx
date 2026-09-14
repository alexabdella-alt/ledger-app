import { describe, it, expect } from "vitest";
import { renderViewHtml } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import ClarificationFlow from "../src/components/ClarificationFlow.jsx";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ═════════════════════════════════════════════════════════════════════════════
// THE CLARIFICATION CARDS, RENDERED (C357). The render sweep hands ClarificationFlow an
// EMPTY queue, so no card body had ever been painted in a test — and these are the most
// owner-facing sentences in the product (O120/O122). Every kind is rendered with a
// realistic item and read: no leaked token, no jargon in any sentence, and always something
// to click or type.
// ═════════════════════════════════════════════════════════════════════════════
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const inv = { id: 1, vendor: "Hill Country Milling Co.", amount: 468.5, date: "2026-08-06", description: "Bread flour", gl_code: "5010", gl_name: "Food Cost", confidence: 62 };
const cards = {
  lifecycle_amount:   { id: "c1", invoice: inv, isLifecycle: true, arrival: { reason: "amount_differs" }, candidateEntry: { amount: 486.5, date: "2026-08-04", description: "Hill Country – ACH DEBIT - HILL COUNTRY MILLING", vendor: "Hill Country Milling" } },
  lifecycle_identity: { id: "c2", invoice: inv, isLifecycle: true, arrival: { reason: "identity_differs" }, candidateEntry: { amount: 468.5, date: "2026-08-04", description: "Franklin – ACH FRANKLIN AVE PROPERTIES LP RENT", vendor: "Franklin" } },
  lifecycle_failed:   { id: "c3", invoice: inv, isLifecycle: true, arrival: { reason: "record_failed" }, candidateEntry: { amount: 468.5, date: "2026-08-04" } },
  duplicate:          { id: "c4", invoice: inv, isDuplicate: true, existingInvoice: { amount: 465.0, date: "2026-07-30" } },
  direction:          { id: "c5", invoice: inv, directionFirst: true, question: "Did you pay this, or did someone pay you?", options: [{ label: "We paid it", value: "expense" }, { label: "We were paid", value: "revenue" }] },
  gaap:               { id: "c6", invoice: { ...inv, amount: 6000, confidence: 85 }, gaap: true, question: "Is this something you'll use for more than a year?", explanation: "Big purchases that last are treated differently.", options: [{ label: "Yes — business use, more than a year", value: "capitalize" }, { label: "No — a one-off cost", value: "expense" }] },
  gl_with_options:    { id: "c7", invoice: { ...inv, confidence: 55, questions: [{ field: "business_purpose", question: "What was this for?", options: ["Office/Operations", "A specific project", "Something else"] }] } },
  gl_missing_facts:   { id: "c8", invoice: { ...inv, vendor: "Unknown", amount: 0, date: "" } },
  gl_no_options:      { id: "c9", invoice: { ...inv, confidence: 55, questions: [{ field: "business_purpose", question: "What was this for?" }] } },
};

describe("★★ every clarification card kind renders clean", () => {
  for (const [name, card] of Object.entries(cards)) {
    it(`${name} — no leaked token, no jargon, something to answer`, () => {
      const t = text(renderViewHtml(ClarificationFlow, { ...POPULATED, clarificationQueue: [card] }));
      expect(t).not.toMatch(/undefined|\bNaN\b|\[object Object\]|Invalid Date/);
      const jargon = t.split(/(?<=[.?!])\s+/).filter((s) => containsOwnerJargon(s));
      expect(jargon).toEqual([]);
      expect(t.length).toBeGreaterThan(80);
    });
  }
  it("★ C357 — an AI question that arrived WITHOUT options is asked in free text, not as a dead card", () => {
    const t = text(renderViewHtml(ClarificationFlow, { ...POPULATED, clarificationQueue: [cards.gl_no_options] }));
    expect(t).toContain("What was this for?");
    // a freetext question renders an input/continue, which the buttons branch never did
    expect(t).toMatch(/Continue|Book it|Save/);
  });
  it("the same question WITH options is buttons", () => {
    const t = text(renderViewHtml(ClarificationFlow, { ...POPULATED, clarificationQueue: [cards.gl_with_options] }));
    expect(t).toContain("Office/Operations");
  });
});
