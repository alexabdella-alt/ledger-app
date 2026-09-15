import { describe, it, expect } from "vitest";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import DashboardView from "../src/components/views/DashboardView.jsx";
import { containsOwnerJargon } from "../src/lib/clarify.js";
import { CLIENT_VIEW_IDS } from "../src/lib/nav.js";
import fs from "fs";

// ═════════════════════════════════════════════════════════════════════════════
// C384 — HOME, RENDERED IN THE OWNER'S SEAT WITH ROWS IN THE COMPANY, READ FOR JARGON.
// C315's source guard holds the eight nav-row screens to the owner bar and never Home —
// the one screen every owner opens first. Rendered rather than grepped: the contracts
// block read "Leases & recurring contracts (ASC 842)" to an owner, and a row's type was
// the raw key ("subscription_paid"). Both seats are rendered; a CPA reading plain words
// loses nothing (C320: one vocabulary).
// ═════════════════════════════════════════════════════════════════════════════
const text = (html) => html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const seats = {
  owner: { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS },
  reviewer: { seat: "reviewer", isReviewerSeat: true, sections: [], viewIds: [...CLIENT_VIEW_IDS, "review", "bank", "recon", "matching", "payroll", "contracts", "add"] },
};
const home = (navSeat, extra = {}) => text(renderViewHtml(DashboardView, {
  ...POPULATED, ...VIEW_CONTEXT["DashboardView.jsx"], navSeat,
  contracts: [{ id: "ct1", counterparty: "Franklin Ave Properties", contract_type: "subscription_paid", payment_amount: 2400, start_date: "2026-01-01", end_date: "2027-12-31", status: "active" }],
  ...extra,
}));
const sentences = (t) => t.split(/(?<=[.?!])\s+|(?= [A-Z][A-Z ]{6,})/);

describe("★★ Home passes the owner bar, rendered", () => {
  for (const [name, navSeat] of Object.entries(seats)) {
    it(`${name} seat — no sentence assumes accounting knowledge, and no raw key or token leaks`, () => {
      const t = home(navSeat);
      expect(t.length).toBeGreaterThan(800);   // anti-vacuity: the page drew
      expect(sentences(t).filter((s) => containsOwnerJargon(s))).toEqual([]);
      expect(t).not.toMatch(/undefined|\bNaN\b|\[object Object\]|subscription_paid|ASC 842/);
    });
  }
  it("the commitment block is present to be checked, and its rows are named by label (structure — the rows sit behind a Show toggle no SSR pass can flip)", () => {
    const t = home(seats.owner);
    expect(t).toContain("active commitment");
    expect(t).toContain("Leases and ongoing agreements");
    const src = fs.readFileSync("src/components/views/DashboardView.jsx", "utf8");
    expect(src).toMatch(/CONTRACT_TYPES\[c\.contract_type\]\?\.label\) \|\| c\.contract_type/);
  });
  it("★ cash under a month's spending is not 'lasts about 0 months'", () => {
    const t = home(seats.owner);   // the fixture's GL cash is 0 against a loss
    expect(t).not.toMatch(/about 0 months/);
    expect(t).toContain("there isn't a month of cash on hand");
  });
});
