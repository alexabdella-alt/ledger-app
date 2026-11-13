// C696 — retirement room for a self-employed owner, and what it saves.
import { describe, it, expect } from "vitest";
import { retirementRoom, RETIREMENT_LIMITS, federalEstimate } from "../src/lib/taxGuidance.js";
import { taxEstimate } from "../src/lib/tax.js";
import { readFileSync } from "node:fs";

describe("C696 — the published limits", () => {
  it("2026: $72,000 total, $24,500 deferral, $8,000 catch-up, $11,250 at 60–63, $360,000 pay cap (Notice 2025-67)", () => {
    expect(RETIREMENT_LIMITS[2026]).toEqual({ total: 72000, deferral: 24500, catchUp50: 8000, catchUp6063: 11250, comp: 360000 });
    expect(RETIREMENT_LIMITS[2025]).toEqual({ total: 70000, deferral: 23500, catchUp50: 7500, catchUp6063: 11250, comp: 350000 });
  });
});

describe("C696 — the room", () => {
  it("SEP = 20% of profit less half the SE tax; Solo 401(k) adds the deferral", () => {
    const r = retirementRoom({ profit: 100000, halfSe: 7064.78, year: 2026 });
    expect(r.sep).toBe(Math.round((100000 - 7064.78) * 0.2 * 100) / 100);
    expect(r.solo401k).toBe(Math.round(((100000 - 7064.78) * 0.2 + 24500) * 100) / 100);
  });
  it("capped at $72,000 together; the deferral can't exceed what's earned", () => {
    expect(retirementRoom({ profit: 500000, halfSe: 15000, year: 2026 })).toMatchObject({ sep: 72000, solo401k: 72000 });
    const small = retirementRoom({ profit: 10000, halfSe: 706.48, year: 2026 });
    expect(small.solo401k).toBe(Math.round((10000 - 706.48) * 100) / 100);   // all of it: 20% + the rest as deferral
  });
  it("nothing for a loss", () => {
    expect(retirementRoom({ profit: -5000, year: 2026 })).toMatchObject({ sep: 0, solo401k: 0 });
  });
});

describe("C696 — what it saves", () => {
  it("lowers income tax, not self-employment tax", () => {
    const a = federalEstimate({ revenue: 100000, year: 2026 });
    const b = federalEstimate({ revenue: 100000, year: 2026, retirement: 18000 });
    expect(b.seTax).toBe(a.seTax);
    expect(b.federal).toBeLessThan(a.federal);
    expect(b.qbi).toBeLessThan(a.qbi);   // it also lowers the income the 20% deduction is figured on
  });
  it("with other income, the 20% deduction is figured on business income less the contribution", () => {
    const f = federalEstimate({ revenue: 100000, year: 2026, otherIncome: 200000, retirement: 18000 });
    expect(f.qbi).toBe(Math.round((100000 - f.halfSe - 18000) * 0.2 * 100) / 100);
  });
  it("the estimate carries the room and the saving for a sole proprietor, not a corporation", () => {
    const led = [{ gl_code: "4000", amount: 100000, debit_credit: "credit", date: "2026-03-01", status: "posted" }];
    const e = taxEstimate(led, 2026, 0, {});
    expect(e.retirement.sep).toBeGreaterThan(18000);
    expect(e.retirement.sepSaves).toBeGreaterThan(0);
    expect(e.retirement.solo401kSaves).toBeGreaterThan(e.retirement.sepSaves);
    expect(taxEstimate(led, 2026, 0, { legalForm: "s_corp" }).retirement).toBe(null);
    expect(taxEstimate(led, 2026, 0, { legalForm: "c_corp" }).retirement).toBe(null);
  });
  it("the Taxes screen and the assistant show it", () => {
    expect(readFileSync("src/components/views/TaxView.jsx", "utf8")).toMatch(/data-retirement-room/);
    expect(readFileSync("src/lib/aiTools.js", "utf8")).toMatch(/retirement_room: est\.retirement \?/);
    expect(readFileSync("supabase/functions/ai-proxy/aiProfiles.js", "utf8")).toMatch(/get_tax_summary's retirement_room/);
  });
});
