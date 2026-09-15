import { describe, it, expect } from "vitest";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";
import { CLIENT_VIEW_IDS } from "../src/lib/nav.js";
import SettingsView from "../src/components/views/SettingsView.jsx";
import CoaView from "../src/components/views/CoaView.jsx";
import OpeningBalancesView from "../src/components/views/OpeningBalancesView.jsx";
import RulesView from "../src/components/views/RulesView.jsx";
import RecurringView from "../src/components/views/RecurringView.jsx";
import Tax1099View from "../src/components/views/Tax1099View.jsx";
import TaxView from "../src/components/views/TaxView.jsx";
import AuditView from "../src/components/views/AuditView.jsx";
import QBOImportView from "../src/components/views/QBOImportView.jsx";
import TeamView from "../src/components/views/TeamView.jsx";

// ═════════════════════════════════════════════════════════════════════════════
// C386 — THE SETTINGS SCREENS, RENDERED IN THE OWNER'S SEAT AND READ. C378 renamed their
// headings; their bodies were never read. Found: "GL" / "GL Account" column headers on
// Supplier rules, Recurring charges and Bank accounts (C330 renamed the same header on seven
// other screens and missed these three), and the Taxes screen printing a chart code under
// every deduction row ("Rent & Occupancy (6100)").
//
// Two bars, stated: the screens that ARE the chart (Categories, starting balances) and the
// two that list categories to pick from (rules, recurring) legitimately show account names
// and numbers, so they are held only to "no bare GL token, no leaked value". The rest are
// held to the full owner bar, sentence by sentence.
// ═════════════════════════════════════════════════════════════════════════════
const text = (html) => html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const navSeat = { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS };
const render = (name, C) => text(renderViewHtml(C, { ...POPULATED, ...(VIEW_CONTEXT[name + ".jsx"] || {}), navSeat, isOwner: true, isAdmin: true }));
const CHART_SCREENS = { SettingsView, CoaView, OpeningBalancesView, RulesView, RecurringView, QBOImportView };
const PLAIN_SCREENS = { TaxView, Tax1099View, AuditView, TeamView };

describe("★ every settings screen renders for an owner without a leaked token or a bare 'GL'", () => {
  for (const [name, C] of Object.entries({ ...CHART_SCREENS, ...PLAIN_SCREENS })) {
    it(name, () => {
      const t = render(name, C);
      expect(t.length).toBeGreaterThan(150);
      expect(t).not.toMatch(/undefined|\bNaN\b|\[object Object\]|Invalid Date/);
      expect(t).not.toMatch(/\bGL\b/);
    });
  }
});

describe("★★ the settings screens that are not the chart pass the owner bar sentence by sentence", () => {
  for (const [name, C] of Object.entries(PLAIN_SCREENS)) {
    it(name, () => {
      const t = render(name, C);
      const bad = t.split(/(?<=[.?!])\s+|(?= [A-Z][A-Z &]{6,})/).filter((s) => containsOwnerJargon(s));
      expect(bad).toEqual([]);
    });
  }
  it("the Taxes screen names deduction accounts without their numbers, and may name IRS forms", () => {
    const t = render("TaxView", TaxView);
    expect(t).toContain("Rent & Occupancy");
    expect(t).not.toMatch(/Rent & Occupancy \(\d{4}\)/);
    expect(containsOwnerJargon("Form 1040-ES / 1120-S / 1065")).toBe(false);
    expect(containsOwnerJargon("booked to 6100")).toBe(true);   // the code guard still bites
  });
});
