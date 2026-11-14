import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import DashboardView, { HOME_OWNER_ACTIVITY_COUNT } from "../src/components/views/DashboardView.jsx";
import { CLIENT_VIEW_IDS, ALL_VIEW_IDS } from "../src/lib/nav.js";

// C639 — the owner's Home: what needs them first; the latest few things, then Money.
const owner = { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS };
const cpa = { seat: "reviewer", isReviewerSeat: true, sections: [], viewIds: ALL_VIEW_IDS };
const src = readFileSync("src/components/views/DashboardView.jsx", "utf8");

describe("the owner's Home", () => {
  // ★ C729 — operator, 2026-11-13: "maybe it's literally just the drop box and the key metrics … this should be
  // brain dead simple". The owner's Home: the drop box, then (only when something waits) the list, then the numbers.
  it("★ the drop box comes first; the waiting list sits right under it, for both seats", () => {
    const dropZone = src.indexOf("{/* ── UNIVERSAL UPLOAD ZONE ── */}");
    const list = src.indexOf("              <HomeWaitingList navTo={navTo} />");
    expect(dropZone).toBeGreaterThan(-1);
    expect(list).toBeGreaterThan(dropZone);
    expect(src).not.toMatch(/\{!cockpit && <HomeWaitingList/);
  });
  it("★ the owner sees the key numbers — tax included — and none of the rest", () => {
    const o = renderViewHtml(DashboardView, { ...POPULATED, ...VIEW_CONTEXT["DashboardView.jsx"], navSeat: owner, companyDataLoaded: true });
    expect(o).toContain("data-owner-numbers");
    for (const k of ["cash", "profit"]) expect(o).toContain(`data-owner-tile="${k}"`);
    expect(o).not.toContain("How your business is doing");
    expect(o).not.toContain("See everything in Money →");     // the activity feed is the accountant's
    expect(o).not.toContain("Ask about your books");            // Ask is in the menu
    expect(o).not.toMatch(/data-trust-panel|Your books, at a glance/);
    expect(src).toMatch(/label: "Set aside for taxes", value: fmtApprox\(setAside\.amount\), tone: "neutral", go: "tax"/);
  });
  it("the accountant's Home is unchanged: books panel, health block, Ask box, activity", () => {
    expect(HOME_OWNER_ACTIVITY_COUNT).toBe(5);
    const c = renderViewHtml(DashboardView, { ...POPULATED, ...VIEW_CONTEXT["DashboardView.jsx"], navSeat: cpa, companyDataLoaded: true });
    expect(c).toContain("How your business is doing");
    expect(c).toContain("Ask about your books");
    expect(c).not.toContain("data-owner-numbers");
  });
});
