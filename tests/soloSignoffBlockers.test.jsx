import { describe, it, expect } from "vitest";
import fs from "fs";
import { ownerSignOffBlockers } from "../src/lib/ownerTrust.js";
import { signOffReadiness } from "../src/lib/controlTotals.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import TrustPanel from "../src/components/views/TrustPanel.jsx";
import { CLIENT_VIEW_IDS } from "../src/lib/nav.js";

// ═════════════════════════════════════════════════════════════════════════════
// C407 — THE SOLO SIGN-OFF CARD SAYS WHY A MONTH CANNOT BE SIGNED, BEFORE THE CLICK,
// IN THE OWNER'S WORDS. It used to let the person tick, press, and then read a CPA-worded
// refusal ("the bank isn't reconciled yet", "3 checks that should match don't: ap_tie").
// ═════════════════════════════════════════════════════════════════════════════
describe("★★ ownerSignOffBlockers", () => {
  it("maps every net signOffReadiness can emit to a plain sentence, and never drops one", () => {
    const r = signOffReadiness({
      controlTotals: { failed: [{ label: "open bills vs payables" }], allTie: false },
      openConfidenceFlags: [{}, {}], droppedDocs: [{}], unknownDocs: [],
      bankMatch: { overdue: true, days: 40 }, setupComplete: false, openingEntered: false,
      entriesInPeriodCount: 0, hasReconForPeriod: false, openHighAnomaliesInPeriod: 1,
    });
    expect(r.ok).toBe(false);
    const out = ownerSignOffBlockers(r.blockers, { periodLabel: "August 2026" });
    expect(out.length).toBe(r.blockers.length);
    for (const s of out) expect([s, containsOwnerJargon(s)]).toEqual([s, false]);
    expect(out).toContain("August 2026 hasn't been matched to your bank statement yet — drop that month's statement.");
    expect(out).toContain("2 transactions still need a look.");
    expect(out).toContain("1 document isn't in your books yet.");
  });
  it("an unknown net is reported, not dropped", () => {
    expect(ownerSignOffBlockers([{ net: "future", reason: "?" }])).toEqual(["Something your accountant can see is still open."]);
    expect(ownerSignOffBlockers([])).toEqual([]);
  });
});

describe("★ the card", () => {
  const base = { ...VIEW_CONTEXT["TrustPanel.jsx"], canSoloAttest: true, selfAttestAcknowledgement: (l) => `I'm signing off ${l} myself.`,
    signoffs: [], invoices: [{ id: 1, date: "2026-08-05", amount: 10, status: "posted" }], navSeat: { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS },
    ownerTrust: { state: "attention", overall: "attention", headline: "x", sub: "", reviewedThrough: null, lines: { captured: { state: "ok", text: "" }, reviewed: { state: "info", text: "" }, correct: { state: "ok", text: "" } }, nudge: null } };
  it("renders the blockers and disables the box when the month is not ready", () => {
    const html = renderViewHtml(TrustPanel, { ...base, signOffReadinessFor: () => ({ ok: false, blockers: [{ net: "bank", reason: "the bank isn't reconciled yet (40 days)" }] }) });
    expect(html).toContain("data-signoff-blocked");
    expect(html).toContain("Not ready to sign yet:");
    expect(html).toMatch(/matched to your bank/);
    expect(html).toMatch(/<input type="checkbox"[^>]*disabled/);
    expect(html).not.toMatch(/reconciled/);
  });
  it("renders no blocker block and an enabled box when the month is ready", () => {
    const html = renderViewHtml(TrustPanel, { ...base, signOffReadinessFor: () => ({ ok: true, blockers: [] }) });
    expect(html).not.toContain("data-signoff-blocked");
    expect(html).not.toMatch(/<input type="checkbox"[^>]*disabled/);
  });
  it("the click path reads the same map, and the button is gated on `blocked` (source)", () => {
    const src = fs.readFileSync("src/components/views/TrustPanel.jsx", "utf8");
    expect(src).toMatch(/ownerSignOffBlockers\(r\.blockers \|\| \[\], \{ periodLabel: label \}\)\[0\]/);
    expect(src).toMatch(/disabled=\{!ack \|\| busy \|\| blocked\}/);
    expect(src).toMatch(/if \(!ack \|\| busy \|\| blocked \|\| !signOffPeriod\) return;/);
  });
});
