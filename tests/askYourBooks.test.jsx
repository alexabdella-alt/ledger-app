// U6 / C380 put an "Ask your books" line on Home. ★ C729 (owner) and C731 (accountant): it left
// Home — Ask is a row in both seats' menus, and the chat opens from there. What must hold: no
// Home without a way to ask, and the Ask row opens the assistant rather than a screen.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import DashboardView from "../src/components/views/DashboardView.jsx";
import { visibleNav, NAV_ACTIONS } from "../src/lib/nav.js";

const rows = (nav) => nav.sections.flatMap((s) => s.items.map(([id]) => id));

describe("Ask your books", () => {
  it("is not a box on Home for either seat", () => {
    for (const isReviewerSeat of [true, false]) {
      const html = renderViewHtml(DashboardView, { ...POPULATED, ...VIEW_CONTEXT["DashboardView.jsx"], navSeat: { seat: isReviewerSeat ? "reviewer" : "client", isReviewerSeat, sections: [], viewIds: [] } });
      expect(html).not.toContain('aria-label="Ask about your books"');
    }
  });
  it("★ is a menu row for the owner AND the accountant, and it opens the assistant", () => {
    expect(rows(visibleNav({ role: "owner" }))).toContain("ask");
    expect(rows(visibleNav({ role: "accountant" }))).toContain("ask");
    expect(NAV_ACTIONS).toContain("ask");
    expect(fs.readFileSync("src/App.jsx", "utf8")).toMatch(/if \(id === "ask"\) \{ setChatOpen\(true\); return; \}/);
  });
});
