// C698 — fixes from the review of C695 / C696.
import { describe, it, expect } from "vitest";
import { retirementRoom } from "../src/lib/taxGuidance.js";
import { taxEstimate, profileForYear } from "../src/lib/tax.js";
import { readFileSync } from "node:fs";

describe("C698 — retirement: catch-up, employees, a job's 401(k), deadlines", () => {
  it("the catch-up needs earnings left after the rest (Solo 401(k) only)", () => {
    expect(retirementRoom({ profit: 10000, halfSe: 706.48, year: 2026 }).catchUp50).toBe(0);    // all earnings already used
    expect(retirementRoom({ profit: 500000, halfSe: 15000, year: 2026 }).catchUp50).toBe(8000);  // at the $72,000 cap, earnings left
  });
  it("employees on the books are flagged; a job is flagged", () => {
    const rev = { gl_code: "4000", amount: 100000, debit_credit: "credit", date: "2026-03-01", status: "posted" };
    const wages = { gl_code: "6000", amount: 20000, date: "2026-03-15", status: "posted" };
    const chart = [{ code: "6000", name: "Salaries & Wages", system_role: "salaries_wages" }];
    expect(taxEstimate([rev, wages], 2026, 0, { chart }).retirement.hasEmployees).toBe(true);
    expect(taxEstimate([rev], 2026, 0, { chart }).retirement.hasEmployees).toBe(false);
    expect(taxEstimate([rev], 2026, 0, { ownWages: 80000 }).retirement.hasJob).toBe(true);
  });
  it("the screen says so, and the deadline wording follows SECURE 2.0", () => {
    const tax = readFileSync("src/components/views/TaxView.jsx", "utf8");
    expect(tax).toMatch(/Because you have employees, a SEP must give them the same percentage, and a Solo 401\(k\) isn't available/);
    expect(tax).toMatch(/If you also save in a 401\(k\) at your job, that counts against the Solo 401\(k\)'s employee limit/);
    expect(tax).not.toMatch(/has to be set up by December 31/);
    expect(readFileSync("src/lib/aiTools.js", "utf8")).not.toMatch(/must exist by Dec 31/);
    const srv = readFileSync("supabase/functions/ai-proxy/aiProfiles.js", "utf8");
    expect(srv).not.toMatch(/Solo 401\(k\) set up by Dec 31/);
    expect(srv).toMatch(/Only call the amount penalty-safe when the basis is last year's tax/);
  });
});

describe("C698 — an older year's estimate doesn't borrow this year's miles", () => {
  it("two years back carries the nearest answers without miles", () => {
    const current = { filing_status: "single", business_miles: 9000, home_office_sqft: 100 };
    const prev = { filing_status: "mfj", other_income: 50000, business_miles: 7000 };
    const p = profileForYear(2024, { current, prev, currentYear: 2026 });
    expect(p).toMatchObject({ filingStatus: "mfj", otherIncome: 50000, businessMiles: 0 });
  });
});

describe("C698 — Home never says \"estimated amount ~$0\"", () => {
  it("the reminder text needs a payment above zero", () => {
    expect(readFileSync("src/components/views/DashboardView.jsx", "utf8")).toMatch(/dl\.est && est && est\.quarterly > 0 \?/);
  });
});
