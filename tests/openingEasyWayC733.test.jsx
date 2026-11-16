// ★ C733 — starting balances, the easy way first: with the statement's figure on offer, the full
// balance-sheet form folds behind "Or enter them yourself"; without one, the page says where the
// easy way is (Home's drop box) and shows the form.
import { describe, it, expect } from "vitest";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import OpeningBalancesView from "../src/components/views/OpeningBalancesView.jsx";
import { CLIENT_VIEW_IDS } from "../src/lib/nav.js";

const owner = { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS };
const base = { ...POPULATED, ...(VIEW_CONTEXT["OpeningBalancesView.jsx"] || {}), navSeat: owner, openingPosted: false, openingBalances: [], cutoffDate: "2026-01-01" };
const offer = { periodStart: "2026-01-01", openingBalance: 4210.55, accountName: "Primary Checking" };

describe("starting balances, the easy way first", () => {
  it("★ with the statement's figure on offer: the offer, then the form folded (closed)", () => {
    const h = renderViewHtml(OpeningBalancesView, { ...base, pendingOpeningProposal: offer }).replace(/<!-- -->/g, "");
    expect(h).toContain("data-opening-offer");
    expect(h).toMatch(/Yes, start from \$4,210\.55/);
    expect(h).toMatch(/<details data-opening-manual(?![^>]*\bopen\b)[^>]*>/);
    expect(h.indexOf("data-opening-offer")).toBeLessThan(h.indexOf("data-opening-manual"));
    expect(h).toContain("Or enter them yourself");
    expect(h).not.toContain("data-opening-easiest");
  });
  it("★ without one: where the easy way is, and the form open", () => {
    const h = renderViewHtml(OpeningBalancesView, { ...base, pendingOpeningProposal: null });
    expect(h).toContain("data-opening-easiest");
    expect(h).toContain("upload your first bank statement on Home");
    expect(h).not.toContain("data-opening-manual");
    expect(h).toContain("Save starting balances");
  });
  it("once saved, neither the offer nor the nudge", () => {
    const h = renderViewHtml(OpeningBalancesView, { ...base, openingPosted: true, pendingOpeningProposal: offer });
    expect(h).not.toContain("data-opening-offer");
    expect(h).not.toContain("data-opening-easiest");
    expect(h).not.toContain("data-opening-manual");
  });
});
