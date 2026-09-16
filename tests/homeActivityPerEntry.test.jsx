import { describe, it, expect } from "vitest";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED, INVOICES } from "./helpers/populatedFixture.js";
import DashboardView from "../src/components/views/DashboardView.jsx";
import { CLIENT_VIEW_IDS } from "../src/lib/nav.js";

// C527 — Home's Activity feed lists one line per entry. With the render fixture now coming out of
// the real flatten, the two-line Sysco bill (i7) rendered as THREE lines — its Food line, its
// Freight line and "Sysco — Accounts Payable −$520.00", the offset leg.
const text = (h) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("C527 — Home's activity feed is one line per entry", () => {
  it("the fixture is faithful: the two-line bill is three flattened rows sharing one entry id", () => {
    expect(INVOICES.filter((r) => r.db_entry_id === "i7").length).toBe(3);
  });
  it("renders the bill once, at $520, with a lines hint — never its A/P leg", () => {
    const navSeat = { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS };
    const t = text(renderViewHtml(DashboardView, { ...POPULATED, ...VIEW_CONTEXT["DashboardView.jsx"], navSeat, companyDataLoaded: true }));
    expect(t).toContain("Sysco — Food Cost · 3 lines");
    expect(t).toContain("520.00");
    expect(t).not.toContain("Sysco — Accounts Payable");
    expect(t).not.toContain("Sysco — Freight");
    expect((t.match(/Sysco —/g) || []).length).toBe(1);
  });
});
