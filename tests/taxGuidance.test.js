import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { lineForAccount, travelSplitFor, homeOfficeDeduction, scheduleCBreakdown, federalEstimate, LINES } from "../src/lib/taxGuidance.js";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../src/lib/constants.js";

// C678 — every spending account on its IRS line, by current guidance. Nobody is asked to "map".
const src = readFileSync("src/lib/coaTemplates.js", "utf8");
const templateRoles = [...src.matchAll(/code: "([5-8]\d{3})"[^}]*system_role: "([a-z_]+)"/g)].map((m) => ({ code: m[1], role: m[2] }));
const defaultRoles = DEFAULT_CHART_OF_ACCOUNTS.filter((a) => /^[5-8]/.test(a.code)).map((a) => ({ code: a.code, role: a.system_role, name: a.name }));

describe("★ every spending account the app creates has a line, chosen by its role", () => {
  for (const a of [...defaultRoles, ...templateRoles]) {
    it(`${a.code} ${a.role}`, () => {
      const r = lineForAccount({ code: a.code, name: a.name || "", role: a.role });
      expect(r.by).toBe("role");   // nothing the app creates falls through to a guess
      expect(r.line === "travel_split" || !!LINES[r.line]).toBe(true);
    });
  }
});

describe("current federal rules", () => {
  it.each([
    ["salaries_wages", "26", 1], ["payroll_tax", "23", 1], ["rent_occupancy", "20b", 1], ["equipment_rental", "20a", 1], ["repairs_maintenance", "21", 1],
    ["vehicle_expenses", "9", 1], ["subcontractor_costs", "11", 1], ["merchant_processing_fees", "10", 1], ["food_cost", "4", 1], ["interest_expense", "16b", 1],
    ["professional_services", "17", 1], ["depreciation_amortization", "13", 1], ["insurance", "15", 1], ["utilities", "25", 1], ["marketing_advertising", "8", 1],
    ["income_tax_expense", "none", 0],
  ])("%s → line %s at %s", (role, line, share) => expect(lineForAccount({ role })).toMatchObject({ line, share }));
  it.each([
    ["Delta Airlines", "24a", 1], ["Marriott Downtown", "24a", 1], ["Uber trip", "24a", 1],
    ["Corner Bistro", "24b", 0.5], ["Client lunch", "24b", 0.5],
    ["Ticketmaster", "none", 0], ["Golf outing", "none", 0],
  ])("a travel-and-entertainment charge from %s → line %s at %s", (vendor, line, share) => expect(travelSplitFor({ vendor })).toEqual({ line, share }));
  it("a category the owner named: its words decide; otherwise by number; otherwise Other expenses", () => {
    expect(lineForAccount({ code: "6950", name: "Camera Gear Rental" })).toMatchObject({ line: "20a" });
    expect(lineForAccount({ code: "6955", name: "Fines & Penalties" })).toMatchObject({ line: "none", share: 0 });
    expect(lineForAccount({ code: "6960", name: "Editing Freelancers" })).toMatchObject({ line: "11" });
    expect(lineForAccount({ code: "5500", name: "Thing We Make" })).toMatchObject({ line: "4" });
    expect(lineForAccount({ code: "7300", name: "Odds and Ends" })).toMatchObject({ line: "27a", by: "default" });
    expect(lineForAccount({ code: "6420", name: "Business Meals" })).toMatchObject({ line: "24b", share: 0.5 });   // a category of its own: still 50%
  });
  it("home office: $5 a square foot, capped at 300 sq ft", () => {
    expect([homeOfficeDeduction(120), homeOfficeDeduction(300), homeOfficeDeduction(450), homeOfficeDeduction(-5)]).toEqual([600, 1500, 1500, 0]);
  });
  it("Social Security stops at the year's wage base; Medicare doesn't", () => {
    expect(federalEstimate({ revenue: 400000, year: 2026 }).seTax).toBe(33590.6);   // 184,500 × 12.4% + 369,400 × 2.9%
    expect(federalEstimate({ revenue: 400000, year: 2025 }).seTax).toBe(r2(176100 * 0.124 + 400000 * 0.9235 * 0.029));
  });
});
const r2 = (n) => Math.round(n * 100) / 100;

describe("★ the year's spending, by line", () => {
  const chart = [{ code: "6400", name: "Travel & Entertainment", system_role: "travel_entertainment" }, { code: "5010", name: "Food Cost", system_role: "food_cost" },
    { code: "6950", name: "Fines & Penalties" }, { code: "6250", name: "Repairs & Maintenance", system_role: "repairs_maintenance" }];
  const row = (code, amount, vendor, extra = {}) => ({ gl_code: code, amount, vendor, date: "2026-03-01", status: "posted", ...extra });
  const sc = scheduleCBreakdown([row("5010", 1000, "Sysco"), row("6400", 400, "Delta Air Lines"), row("6400", 100, "Corner Bistro"), row("6400", 80, "Ticketmaster"),
    row("6250", 300, "Plumber"), row("6950", 50, "City of Austin"), row("6250", 999, "x", { status: "voided" })], 2026, { chart, homeOfficeSqft: 120 });
  it("each line, food cost included (it used to count for nothing)", () => {
    expect(sc.rows.map((r) => [r.line, r.spent, r.deductible])).toEqual([["4", 1000, 1000], ["21", 300, 300], ["24a", 400, 400], ["24b", 100, 50], ["30", 600, 600], ["none", 130, 0]]);
  });
  it("what counts and what doesn't", () => {
    expect([sc.deductibleTotal, sc.notDeductible]).toEqual([2350, 180]);
  });
  it("no home office for a corporation (its own reimbursement rules)", () => {
    expect(scheduleCBreakdown([], 2026, { homeOfficeSqft: 200, legalForm: "s_corp" }).homeOffice).toBe(0);
  });
});

describe("the screens use it", () => {
  it("Taxes, Home, the deadline reminder and the assistant pass the chart and the legal form", () => {
    expect(readFileSync("src/components/views/TaxView.jsx", "utf8")).toMatch(/taxEstimate\(invoices, year, estPaid, \{ chart: CHART_OF_ACCOUNTS \|\| \[\], legalForm, assets: taxAssets \|\| null, \.\.\.profile \}\)/);   // C690
    expect(readFileSync("src/components/views/DashboardView.jsx", "utf8")).toMatch(/taxEstimate\(invoices \|\| \[\], y, 0, \{ chart: CHART_OF_ACCOUNTS/);
    expect(readFileSync("src/App.jsx", "utf8")).toMatch(/taxEstimate\(invoicesRef\.current, y, 0, \{ chart: CHART_OF_ACCOUNTS/);
    expect(readFileSync("src/lib/aiTools.js", "utf8")).toMatch(/taxEstimate\(led, year, 0, \{ chart: ctx\.chartOfAccounts/);
  });
});
