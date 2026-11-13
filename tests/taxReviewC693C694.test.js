// C693 / C694 — fixes from the review of the bracket estimate (C690) and the sorting (C691).
import { describe, it, expect } from "vitest";
import { federalEstimate, travelSplitFor, lineForAccount } from "../src/lib/taxGuidance.js";
import { taxProfileFrom, profileForYear, taxEstimate } from "../src/lib/tax.js";
import { paymentKindForAccount, PAYMENT_KIND } from "../src/lib/form1099.js";
import { readFileSync } from "node:fs";

const r2 = (n) => Math.round(n * 100) / 100;

describe("C693 — answers carry forward, and January's reminder uses last year's", () => {
  it("a year with no answer uses the other year's, field by field, and says so", () => {
    const p = taxProfileFrom({}, { filing_status: "mfj", other_income: 150000, own_wages: 0, home_office_sqft: 200 });
    expect(p).toMatchObject({ filingStatus: "mfj", otherIncome: 150000, homeOfficeSqft: 200, assumed: false, carried: true });
    expect(taxProfileFrom({ filing_status: "single" }, { filing_status: "mfj" })).toMatchObject({ filingStatus: "single", carried: false });
  });
  it("miles are this year's only", () => {
    expect(taxProfileFrom({}, { business_miles: 9000 }).businessMiles).toBe(0);
  });
  it("last year's estimate reads last year's answers first", () => {
    const current = { filing_status: "single" }, prev = { filing_status: "mfj", other_income: 150000 };
    expect(profileForYear(2025, { current, prev, currentYear: 2026 })).toMatchObject({ filingStatus: "mfj", otherIncome: 150000 });
    expect(profileForYear(2026, { current, prev, currentYear: 2026 })).toMatchObject({ filingStatus: "single", otherIncome: 150000, carried: true });
  });
  it("the app loads last year's row and both reminders use profileForYear", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/\.eq\("tax_year", new Date\(\)\.getFullYear\(\) - 1\)\.maybeSingle\(\);   \/\/ C693/);
    expect(app).toMatch(/setFiledDeadlines\(\{\}\); setFiledDeadlinesPrev\(\{\}\);/);
    expect(readFileSync("src/components/views/TaxView.jsx", "utf8")).toMatch(/const lsKey = `cfai_tax_\$\{currentCompany\?\.id \|\| "x"\}_\$\{year\}`;/);
  });
});

describe("C693 — the owner's own wages use up the Social Security wage base", () => {
  it("$180k job + $100k profit (2026): only $4,500 of SS room left; the 0.9% threshold drops by the wages", () => {
    const f = federalEstimate({ revenue: 100000, year: 2026, ownWages: 180000 });
    expect(f.seTax).toBe(r2(4500 * 0.124 + 92350 * 0.029));
    expect(f.addlMedicare).toBe(r2((92350 - 20000) * 0.009));
  });
  it("other household income doesn't touch the wage base", () => {
    expect(federalEstimate({ revenue: 100000, year: 2026, otherIncome: 180000 }).seTax).toBe(r2(92350 * 0.153));
  });
  it("both count for income tax", () => {
    expect(federalEstimate({ revenue: 50000, year: 2026, ownWages: 60000 }).federal).toBeGreaterThan(federalEstimate({ revenue: 50000, year: 2026 }).federal);
  });
});

describe("C693 — a loss lowers the tax on other income; nothing to set aside", () => {
  it("negative federal, no SE tax, and the estimate never asks for a payment", () => {
    const f = federalEstimate({ revenue: -10000, year: 2026, otherIncome: 80000 });
    expect(f).toMatchObject({ seTax: 0, federal: -2200, total: -2200 });
    expect(federalEstimate({ revenue: -10000, year: 2026 }).total).toBe(0);
    const est = taxEstimate([{ gl_code: "6100", amount: 10000, date: "2026-01-01", status: "posted" }], 2026, 0, { otherIncome: 80000 });
    expect(est.owed).toBe(0); expect(est.quarterly).toBe(0); expect(est.taxableNet).toBe(0);
  });
  it("a C corporation's loss is not a refund", () => {
    expect(federalEstimate({ revenue: -10000, year: 2026, legalForm: "c_corp" }).total).toBe(0);
  });
});

describe("C694 — food is a meal wherever it's eaten; a ticket is a show", () => {
  for (const v of ["Airport Bar & Grill", "Hampton Social", "Hilton Head Pizza", "Delta Diner", "Courtyard Cafe", "Frontier Grill", "Summit Steakhouse", "Expo Grill", "Conference dinner with client"])
    it(`${v} → 50%`, () => expect(travelSplitFor({ vendor: v })).toEqual({ line: "24b", share: 0.5 }));
  it("United Center tickets → 0%; a flight ticket → travel", () => {
    expect(travelSplitFor({ vendor: "United Center tickets" })).toEqual({ line: "none", share: 0 });
    expect(travelSplitFor({ vendor: "Delta flight tickets" })).toEqual({ line: "24a", share: 1 });
    expect(travelSplitFor({ vendor: "DELTA AIR 0062" })).toEqual({ line: "24a", share: 1 });
  });
  it("a category: meals before conferences; Meals & Entertainment read charge by charge", () => {
    expect(lineForAccount({ name: "Meals at conferences" })).toMatchObject({ line: "24b", share: 0.5 });
    expect(lineForAccount({ name: "Meals & Entertainment" }).line).toBe("travel_split");
    expect(lineForAccount({ name: "Conference tickets" }).line).toBe("27a");
  });
});

describe("C694 — the utility rule doesn't hide a 1099", () => {
  it("Electric Repairs / Contractor stay services; Electric Vehicle is the car", () => {
    expect(lineForAccount({ name: "Electric Repairs" }).line).toBe("21");
    expect(lineForAccount({ name: "Electric Contractor" }).line).toBe("11");
    expect(lineForAccount({ name: "Electric Vehicle" }).line).toBe("9");
    expect(paymentKindForAccount({ name: "Electric Contractor" })).toBe(PAYMENT_KIND.SERVICES);
    expect(lineForAccount({ name: "Gas & Electric" }).line).toBe("25");
  });
  it("Meals & Entertainment is not a 1099 payment", () => {
    expect(paymentKindForAccount({ name: "Meals & Entertainment" })).toBe(PAYMENT_KIND.NOT_REPORTABLE);
  });
});

describe("C694 — a penalty is never a deductible tax", () => {
  it("State Tax Penalties stays out for a corporation; City Taxi is not a tax", () => {
    expect(lineForAccount({ name: "State Tax Penalties", legalForm: "c_corp" })).toMatchObject({ line: "none", share: 0 });
    expect(lineForAccount({ name: "State tax interest", legalForm: "c_corp" }).line).not.toBe("23");
    expect(lineForAccount({ name: "City Taxi", legalForm: "c_corp" }).line).not.toBe("23");
    expect(lineForAccount({ name: "State Income Tax", legalForm: "c_corp" }).line).toBe("23");
  });
});
