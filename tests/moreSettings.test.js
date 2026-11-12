import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MORE_SETTINGS_PAGES } from "../src/lib/moreSettings";
import { OWNER_SETTINGS_ITEMS, NAV_SECTION_SETTINGS, MORE_SETTINGS_GROUP } from "../src/lib/nav.js";
import { renderViewHtml } from "./helpers/renderView.jsx";
import MoreSettingsView from "../src/components/views/MoreSettingsView.jsx";

// C638 — the owner's Settings: four rows, the rest on "More settings".
describe("More settings", () => {
  it("★ every accountant Settings page is either an owner row or on More settings — none lost", () => {
    const ownerRows = OWNER_SETTINGS_ITEMS.map(([id]) => id);
    const more = MORE_SETTINGS_PAGES.map((p) => p.view);
    for (const [id] of NAV_SECTION_SETTINGS.items) expect([id, ownerRows.includes(id) || more.includes(id)]).toEqual([id, true]);
  });
  it("each page says in one line what it is for, with no accounting words", () => {
    for (const p of MORE_SETTINGS_PAGES) {
      expect(p.what.length).toBeGreaterThan(20);
      expect(p.what).not.toMatch(/\b(GL|ledger|chart of accounts|journal|debit|credit|accrual)\b/i);
    }
  });
  it("standing on any of them highlights More settings (1099s highlight Taxes)", () => {
    for (const p of MORE_SETTINGS_PAGES.filter((x) => x.view !== "tax1099")) expect(MORE_SETTINGS_GROUP).toContain(p.view);
  });
  it("★ renders every page as a row, and the page is routed", () => {
    const html = renderViewHtml(MoreSettingsView, {});
    for (const p of MORE_SETTINGS_PAGES) expect(html).toContain(`data-more-settings="${p.view}"`);
    expect(readFileSync("src/App.jsx", "utf8")).toMatch(/\{view==="settings-more" && <MoreSettingsView \/>\}/);
  });
});
