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
  it("★ the list of things waiting on them comes before the drop zone (owner seat only)", () => {
    const ownerList = src.indexOf("{!cockpit && <HomeWaitingList navTo={navTo} />}");
    const dropZone = src.indexOf("{/* ── UNIVERSAL UPLOAD ZONE ── */}");
    const cpaList = src.indexOf("{cockpit && <HomeWaitingList navTo={navTo} />}");
    expect(ownerList).toBeGreaterThan(-1);
    expect(ownerList).toBeLessThan(dropZone);
    expect(cpaList).toBeGreaterThan(dropZone);   // the accountant's layout is unchanged
  });

  it("★ recent activity shows the latest few and points at Money; the accountant keeps 'Load more'", () => {
    expect(HOME_OWNER_ACTIVITY_COUNT).toBe(5);
    const o = renderViewHtml(DashboardView, { ...POPULATED, ...VIEW_CONTEXT["DashboardView.jsx"], navSeat: owner, companyDataLoaded: true });
    expect(o).toContain("See everything in Money →");
    expect(o).not.toContain(">Load more<");
    const c = renderViewHtml(DashboardView, { ...POPULATED, ...VIEW_CONTEXT["DashboardView.jsx"], navSeat: cpa, companyDataLoaded: true });
    expect(c).not.toContain("See everything in Money →");
  });
});
