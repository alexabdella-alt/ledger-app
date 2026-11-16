// ★ C732 — the Taxes screen answers first: what to keep aside and the next deadline, then the next
// three deadlines; "Your tax details", "How we worked this out" and the deductions are folded
// (native <details> — the content stays in the page, closed until opened). Nothing removed.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED, ACCOUNTS } from "./helpers/populatedFixture.js";
import TaxView from "../src/components/views/TaxView.jsx";
import { CLIENT_VIEW_IDS } from "../src/lib/nav.js";

const owner = { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS };
const render = (extra = {}) => renderViewHtml(TaxView, { ...POPULATED, ...(VIEW_CONTEXT["TaxView.jsx"] || {}), CHART_OF_ACCOUNTS: ACCOUNTS, navSeat: owner, companyDataLoaded: true, ...extra });
const src = readFileSync("src/components/views/TaxView.jsx", "utf8");

describe("the Taxes screen, answer first", () => {
  const h = render();
  const at = (s) => h.indexOf(s);
  it("★ the order: answer → deadlines → your details → how we worked it out → deductions → the preparer's file", () => {
    const order = ["data-tax-answer", "Upcoming tax deadlines", "data-tax-details", "data-tax-how", "data-tax-deductions", "data-tax-packet", "data-tax-disclaimer"].map(at);
    for (const i of order) expect(i).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("the answer says what to keep aside and names the next deadline", () => {
    expect(h.replace(/<!-- -->/g, "")).toMatch(/Keep aside for taxes · \d{4}/);
    expect(h).toContain("data-tax-keep");
    expect(h).toMatch(/data-tax-next[^>]*>[\s\S]*?Next: /);
  });
  it("★ the working-out and the deductions are folded (closed), their content still in the page", () => {
    expect(h).toMatch(/<details data-tax-how(?![^>]*\bopen\b)[^>]*>/);
    expect(h).toMatch(/<details data-tax-deductions(?![^>]*\bopen\b)[^>]*>/);
    expect(h).toContain("Estimated tax for the year");      // inside "How we worked this out"
    expect(h).toContain("Home office");                     // inside the deductions
  });
  it("your tax details open themselves while the business's filing type is unknown, and fold once it's set", () => {
    expect(render({ companySettings: { ...(POPULATED.companySettings || {}), legalForm: "" } })).toMatch(/<details data-tax-details[^>]*\bopen\b/);
    expect(render({ companySettings: { ...(POPULATED.companySettings || {}), legalForm: "sole_prop" } })).toMatch(/<details data-tax-details(?![^>]*\bopen\b)[^>]*>/);
    // decided once on arrival — answering the question inside doesn't snap it shut mid-edit
    expect(src).toMatch(/const \[detailsOpenAtFirst\] = React\.useState\(\(\) => !legalForm\);/);
  });
  it("at most three deadlines show; the rest are folded behind 'More deadlines'", () => {
    expect(src).toMatch(/const upcoming = deadlines\.filter\(d => !isFiledD\(d\)\)\.slice\(0, 3\);/);
    const before = h.slice(0, Math.max(0, at("data-tax-more-deadlines")) || h.length);
    expect((before.slice(at("Upcoming tax deadlines")).match(/Mark filed|✓ Filed/g) || []).length).toBeLessThanOrEqual(3);
  });
  it("the 1099 card sits at the top only when something needs filing; otherwise at the bottom", () => {
    expect(src).toMatch(/\{need1099 > 0 && \(<>/);
    expect(src).toMatch(/\{need1099 <= 0 && \(<>/);
    expect(src.indexOf("{need1099 > 0 && (<>")).toBeLessThan(src.indexOf("DEADLINE TRACKER"));
    expect(src.indexOf("{need1099 <= 0 && (<>")).toBeGreaterThan(src.indexOf("FOR YOUR TAX PREPARER"));
  });
  it("no 'TAX COMPLIANCE' kicker, and the disclaimer is a quiet line, not an amber box", () => {
    expect(h).not.toContain("TAX COMPLIANCE");
    expect(src).not.toMatch(/background: "var\(--sc-warning-soft\)", border: "1px solid var\(--sc-warning-soft\)", borderRadius: 14, padding: "16px 20px"/);
  });
});
