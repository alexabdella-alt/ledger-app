// ★ C737 — the phone layout of the owner's main screens. Money's list was a 760px table cut off at
// the right (amounts out of sight); Taxes' deadline titles were squeezed beside the days and the
// button; Home's three numbers were a screen of big type each. All phone-only (≤ 760px) CSS.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import MoneyView from "../src/components/views/MoneyView.jsx";
import { CLIENT_VIEW_IDS } from "../src/lib/nav.js";

const css = readFileSync("src/styles.css", "utf8");
const phone = css.slice(css.indexOf("@media (max-width: 760px)"), css.indexOf("@media (max-width: 420px)"));

describe("phone layout", () => {
  it("★ Money's transactions become two-line rows: who · amount, then date · category · status", () => {
    expect(phone).toMatch(/\.sc-page table\.sc-txn-table \{ display: block !important; min-width: 0 !important;/);
    expect(phone).toMatch(/grid-template-areas: "party party amt" "date cat status" "act act act";/);
    expect(phone).toMatch(/\.sc-txn-table thead \{ display: none !important; \}/);
    const h = renderViewHtml(MoneyView, { ...POPULATED, ...(VIEW_CONTEXT["MoneyView.jsx"] || {}), navSeat: { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS }, companyDataLoaded: true });
    expect(h).toContain('class="sc-txn-table"');
    for (const c of ["sc-txn-row", "sc-c-party", "sc-c-amt", "sc-c-date", "sc-c-cat", "sc-c-status", "sc-c-act"]) expect([c, h.includes(`class="${c}"`)]).toEqual([c, true]);
  });
  it("Home's numbers are one line each; Taxes' deadlines wrap under their title", () => {
    expect(phone).toMatch(/\.sc-owner-tile \{ display: flex !important;/);
    expect(phone).toMatch(/\.sc-deadline-row \{ flex-wrap: wrap !important;/);
    expect(readFileSync("src/components/views/DashboardView.jsx", "utf8")).toContain('className="sc-owner-tile"');
    expect(readFileSync("src/components/views/TaxView.jsx", "utf8")).toContain('className="sc-deadline-row"');
  });
  it("none of it touches a laptop: every new rule is inside the 760px block", () => {
    const outside = css.replace(phone, "");
    expect(outside).not.toMatch(/sc-txn-table|sc-owner-tile|sc-deadline-row/);
  });
});
