import { describe, it, expect } from "vitest";
import { bonusRateFor, taxDepreciationFor, scheduleCBreakdown } from "../src/lib/taxGuidance.js";
import { taxEstimate } from "../src/lib/tax.js";

// C683 — equipment for tax: bonus depreciation, not the books' straight line.
describe("the bonus percentage by when it went into service", () => {
  it.each([["2026-03-01", 1], ["2025-01-20", 1], ["2025-01-19", 0.4], ["2024-06-01", 0.6], ["2023-06-01", 0.8], ["2020-06-01", 1], ["2016-06-01", 0.5], ["", 0]])(
    "%s → %s", (d, r) => expect(bonusRateFor(d)).toBe(r));
});

describe("★ a $3,000 camera put into service March 2026", () => {
  const assets = [{ id: "A", cost: 3000, in_service_date: "2026-03-01", useful_life_months: 60 }];
  const posted = Array.from({ length: 10 }, (_, i) => ({ asset_id: "A", period_date: `2026-${String(i + 3).padStart(2, "0")}-28`, amount: 50 }));
  it("for tax: the whole $3,000 in 2026; the books' $500 of depreciation is what it replaces", () => {
    expect(taxDepreciationFor({ assets, posted, year: 2026 })).toEqual({ tax: 3000, bookTracked: 500 });
    expect(taxDepreciationFor({ assets, posted, year: 2027 })).toEqual({ tax: 0, bookTracked: 0 });
  });
  it("Schedule C line 13 claims $3,000, not $500 — and not $3,500", () => {
    const books = posted.map((p, i) => ({ gl_code: "6900", amount: 50, date: p.period_date, status: "posted", id: `d${i}` }));
    const sc = scheduleCBreakdown(books, 2026, { chart: [{ code: "6900", name: "Depreciation & Amortization", system_role: "depreciation_amortization" }],
      depreciation: taxDepreciationFor({ assets, posted, year: 2026 }) });
    const l13 = sc.rows.find((r) => r.line === "13");
    expect([l13.spent, l13.deductible, l13.taxAdjusted]).toEqual([500, 3000, true]);
    expect(sc.notDeductible).toBe(0);
  });
  it("the estimate uses it: $2,500 more deducted lowers the tax", () => {
    const books = [{ gl_code: "4000", amount: 20000, date: "2026-02-01", status: "posted" },
      ...posted.map((p, i) => ({ gl_code: "6900", amount: 50, date: p.period_date, status: "posted", id: `d${i}` }))];
    const chart = [{ code: "6900", name: "Depreciation & Amortization", system_role: "depreciation_amortization" }];
    const plain = taxEstimate(books, 2026, 0, { chart });
    const withAssets = taxEstimate(books, 2026, 0, { chart, assets: { assets, posted } });
    expect(plain.taxableNet).toBe(19500);
    expect(withAssets.taxableNet).toBe(17000);
    expect(withAssets.total).toBeLessThan(plain.total);
  });
});

describe("an asset from 2024 (60% bonus)", () => {
  const assets = [{ id: "B", cost: 10000, in_service_date: "2024-07-01", useful_life_months: 60 }];
  it("2024: 60% plus six months of the rest; 2026: twelve months of the rest", () => {
    expect(taxDepreciationFor({ assets, year: 2024 }).tax).toBe(6400);   // 6,000 + 4,000 × 6/60
    expect(taxDepreciationFor({ assets, year: 2026 }).tax).toBe(800);    // 4,000 × 12/60
  });
});

// The Taxes screen says it in plain words when the equipment line is adjusted for tax.
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED, ACCOUNTS } from "./helpers/populatedFixture.js";
import TaxView from "../src/components/views/TaxView.jsx";
import { OWNER_JARGON_RE } from "../src/lib/clarify.js";
describe("the screen, with equipment", () => {
  it("explains the equipment line without accounting words", () => {
    const yr = new Date().getFullYear();
    const html = renderViewHtml(TaxView, { ...POPULATED, ...(VIEW_CONTEXT["TaxView.jsx"] || {}), CHART_OF_ACCOUNTS: ACCOUNTS, companyDataLoaded: true,
      navSeat: { seat: "client", isReviewerSeat: false, sections: [], viewIds: [] },
      taxAssets: { assets: [{ id: "A", cost: 3000, in_service_date: `${yr}-03-01`, useful_life_months: 60 }], posted: [] } });
    const t = html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
    expect(t).toMatch(/equipment is mostly deducted in full in the year you start using it/);
    const line = t.slice(t.indexOf("Equipment cost, spread over time"), t.indexOf("Equipment cost, spread over time") + 260);
    expect(line).not.toMatch(OWNER_JARGON_RE);
  });
});
