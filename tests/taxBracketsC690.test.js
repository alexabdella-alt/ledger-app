// C690 — the federal estimate by the year's brackets, standard deduction and the QBI cap.
import { describe, it, expect } from "vitest";
import { federalEstimate, incomeTax, standardDeduction, BRACKET_TOPS, STANDARD_DEDUCTION } from "../src/lib/taxGuidance.js";
import { taxEstimate, taxProfileFrom } from "../src/lib/tax.js";
import { readFileSync } from "node:fs";

describe("C690 — the published figures", () => {
  it("standard deductions: 2025 as amended by P.L. 119-21, 2026 by Rev. Proc. 2025-32", () => {
    expect(STANDARD_DEDUCTION[2025]).toEqual({ single: 15750, mfj: 31500, mfs: 15750, hoh: 23625 });
    expect(STANDARD_DEDUCTION[2026]).toEqual({ single: 16100, mfj: 32200, mfs: 16100, hoh: 24150 });
  });
  it("2026 bracket tops (IRS IR-2025-103)", () => {
    expect(BRACKET_TOPS[2026].single).toEqual([12400, 50400, 105700, 201775, 256225, 640600]);
    expect(BRACKET_TOPS[2026].mfj).toEqual([24800, 100800, 211400, 403550, 512450, 768700]);
    expect(BRACKET_TOPS[2026].hoh).toEqual([17700, 67450, 105700, 201750, 256200, 640600]);
  });
  it("income tax walks the brackets", () => {
    expect(incomeTax(100000, { year: 2026 })).toBe(16712);          // 1,240 + 4,560 + 10,912
    expect(incomeTax(12400, { year: 2026 })).toBe(1240);
    expect(incomeTax(1000000, { year: 2026, filingStatus: "single" })).toBe(
      Math.round((12400 * .10 + 38000 * .12 + 55300 * .22 + 96075 * .24 + 54450 * .32 + 384375 * .35 + 359400 * .37) * 100) / 100);
    expect(incomeTax(-5, { year: 2026 })).toBe(0);
  });
  it("an unknown year uses the nearest published one; an unknown status is single", () => {
    expect(standardDeduction(2031, "mfj")).toBe(32200);
    expect(standardDeduction(2019, "single")).toBe(14600);
    expect(standardDeduction(2026, "weird")).toBe(16100);
  });
});

describe("C690 — the estimate", () => {
  it("$50,000 profit, single, no other income, 2025 — about $9,775, not $16,358", () => {
    const f = federalEstimate({ revenue: 50000, year: 2025 });
    expect(f.seTax).toBe(7064.78);
    expect(f.qbi).toBe(6143.52);              // capped at 20% of taxable income before it
    expect(f.federal).toBe(2710.39);
    expect(f.total).toBe(9775.17);
  });
  it("a small profit under the standard deduction owes only self-employment tax", () => {
    expect(federalEstimate({ revenue: 6000, year: 2025 })).toMatchObject({ federal: 0, total: 847.77 });
  });
  it("other income raises the business's tax (it is stacked on top), married filing together lowers it", () => {
    const alone = federalEstimate({ revenue: 50000, year: 2025 }).federal;
    expect(federalEstimate({ revenue: 50000, year: 2025, otherIncome: 80000 }).federal).toBeGreaterThan(alone);
    expect(federalEstimate({ revenue: 50000, year: 2025, filingStatus: "mfj" }).federal).toBeLessThan(alone);
  });
  it("the business's share is the tax with it minus the tax without it", () => {
    const f = federalEstimate({ revenue: 50000, year: 2026, otherIncome: 80000 });
    const before = incomeTax(80000 - 16100, { year: 2026 });
    const taxable = 80000 + 50000 - f.halfSe - 16100;
    expect(f.federal).toBe(Math.round((incomeTax(taxable - f.qbi, { year: 2026 }) - before) * 100) / 100);
    expect(f.qbi).toBe(Math.round((50000 - f.halfSe) * 0.2 * 100) / 100);   // under the taxable-income cap here
  });
  it("Additional Medicare follows the filing status", () => {
    expect(federalEstimate({ revenue: 300000, year: 2026, filingStatus: "mfj" }).addlMedicare).toBe(Math.round((300000 * 0.9235 - 250000) * 0.009 * 100) / 100);
    expect(federalEstimate({ revenue: 300000, year: 2026, filingStatus: "mfs" }).addlMedicare).toBe(Math.round((300000 * 0.9235 - 125000) * 0.009 * 100) / 100);
  });
  it("flags when the 20% deduction may be limited", () => {
    expect(federalEstimate({ revenue: 400000, year: 2026 }).qbiMayBeLimited).toBe(true);
    expect(federalEstimate({ revenue: 100000, year: 2026 }).qbiMayBeLimited).toBe(false);
  });
  it("what a dollar of deductions saves is measured from the estimate", () => {
    const f = federalEstimate({ revenue: 50000, year: 2025 });
    expect(f.marginalRate).toBeGreaterThan(0.2);
    expect(f.marginalRate).toBeLessThan(0.25);
    expect(federalEstimate({ revenue: 50000, year: 2025, legalForm: "c_corp" }).marginalRate).toBe(0.21);
  });
});

describe("C690 — asked once, used everywhere", () => {
  it("the profile comes from the year's saved tax settings; nothing saved is assumed single", () => {
    expect(taxProfileFrom({})).toEqual({ homeOfficeSqft: 0, filingStatus: "single", otherIncome: 0, assumed: true });
    expect(taxProfileFrom({ filing_status: "mfj", other_income: "62000", home_office_sqft: 120 })).toEqual({ homeOfficeSqft: 120, filingStatus: "mfj", otherIncome: 62000, assumed: false });
  });
  it("taxEstimate passes them through", () => {
    const led = [{ id: "r", date: "2026-03-01", gl_code: "4000", amount: 50000, debit_credit: "credit", status: "booked" }];
    const a = taxEstimate(led, 2026, 0, {});
    const b = taxEstimate(led, 2026, 0, { filingStatus: "mfj" });
    expect(b.federal).toBeLessThan(a.federal);
  });
  it("the Taxes screen, Home, the reminders and the assistant read the same profile", () => {
    const tax = readFileSync("src/components/views/TaxView.jsx", "utf8");
    expect(tax).toMatch(/const profile = taxProfileFrom\(filed\);/);
    expect(tax).toMatch(/filing_status: e\.target\.value \|\| null/);
    expect(tax).toMatch(/other_income: v/);
    expect(tax).not.toMatch(/FED_RATE/);
    expect(readFileSync("src/components/views/DashboardView.jsx", "utf8")).toMatch(/\.\.\.taxProfileFrom\(filedDeadlines\)/);
    expect(readFileSync("src/App.jsx", "utf8")).toMatch(/\.\.\.taxProfileFrom\(filedDeadlinesRef\.current\)/);
    expect(readFileSync("src/App.jsx", "utf8")).toMatch(/taxProfile: filedDeadlines,/);
    expect(readFileSync("src/lib/aiTools.js", "utf8")).toMatch(/const profile = taxProfileFrom\(ctx\.taxProfile \|\| \{\}\);/);
  });
});

describe("C690 — the assistant's instructions use the screen's figures", () => {
  const srv = readFileSync("supabase/functions/ai-proxy/aiProfiles.js", "utf8");
  it("no flat 25% left; it reads get_tax_summary", () => {
    expect(srv).not.toMatch(/25% of net/);
    expect(srv).not.toMatch(/simplified 25% federal planning rate/);
    expect(srv).toMatch(/call get_tax_summary and give ITS figures/);
    expect(srv).toMatch(/call get_tax_summary and use deductions_by_category/);
    expect(srv).toMatch(/\$2,000 for payments from 2026 — counted by the year PAID/);
  });
});
