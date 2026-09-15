import { describe, it, expect } from "vitest";
import fs from "fs";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import TrustPanel from "../src/components/views/TrustPanel.jsx";
import { CLIENT_VIEW_IDS } from "../src/lib/nav.js";

// ═════════════════════════════════════════════════════════════════════════════
// C405 — "ANSWER N QUESTIONS" OPENS THE QUESTIONS, NOT THE REVIEW TAB. Operator, on the
// live app: "when I click this button it goes to the review tab — that doesn't seem
// right." It had pointed at Review since C197; the questions live on Home.
// ═════════════════════════════════════════════════════════════════════════════
const src = fs.readFileSync("src/components/views/TrustPanel.jsx", "utf8").replace(/^[ \t]*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const trust = (kind) => ({
  state: "attention", headline: "A couple of things need a look.", sub: "", overall: "attention", reviewedThrough: null,
  lines: { captured: { state: "ok", text: "Everything you sent is accounted for." }, reviewed: { state: "info", text: "Nobody has reviewed these yet." }, correct: { state: "attention", text: "We've asked you about 4 transactions — they're not in your books until you answer." } },
  nudge: { kind, count: 4, text: "Answer 4 questions" },
});
const seat = (reviewer) => ({ seat: reviewer ? "reviewer" : "client", isReviewerSeat: reviewer, sections: [], viewIds: reviewer ? [...CLIENT_VIEW_IDS, "review"] : CLIENT_VIEW_IDS });

describe("★★ the clarification nudge", () => {
  it("is a BUTTON on both seats (the client used to get status only), marked as the clarification door", () => {
    for (const reviewer of [false, true]) {
      const html = renderViewHtml(TrustPanel, { ...VIEW_CONTEXT["TrustPanel.jsx"], ownerTrust: trust("clarification"), navSeat: seat(reviewer) });
      expect(html).toMatch(/<button[^>]*data-nudge="clarification"/);
      expect(html).toContain("Answer 4 questions");
    }
  });
  it("opens the click-through when cards are on screen, else scrolls to the waiting-on-you list — never Review", () => {
    const fn = src.slice(src.indexOf("const goQuestions = () => {"), src.indexOf("const onNudge"));
    expect(fn).toContain('new CustomEvent("sc:open-stepper")');
    expect(fn).toContain('getElementById("waiting-on-you")');
    expect(fn).not.toMatch(/review/i);
    expect(src).toMatch(/const onNudge = nudge\?\.kind === "clarification" \? goQuestions : goReview;/);
  });
  it("the confidence-flag nudge keeps its reviewer door: a button for a reviewer, status for a client", () => {
    const cpa = renderViewHtml(TrustPanel, { ...VIEW_CONTEXT["TrustPanel.jsx"], ownerTrust: trust("confidence"), navSeat: seat(true) });
    expect(cpa).toMatch(/<button[^>]*data-nudge="confidence"/);
    const owner = renderViewHtml(TrustPanel, { ...VIEW_CONTEXT["TrustPanel.jsx"], ownerTrust: trust("confidence"), navSeat: seat(false) });
    expect(owner).not.toMatch(/data-nudge=/);
    expect(owner).toMatch(/We(&#x27;|')ve asked you about 4 transactions/);
  });
  it("the stepper listens for the event the nudge dispatches (one contract)", () => {
    const flow = fs.readFileSync("src/components/ClarificationFlow.jsx", "utf8");
    expect(flow).toContain('window.addEventListener("sc:open-stepper", onOpen)');
  });
});
