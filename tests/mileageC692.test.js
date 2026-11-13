// C692 — the standard mileage rate, by year, with 2026's mid-year change.
import { describe, it, expect } from "vitest";
import { mileageDeduction, mileageRatesFor, isParkingOrToll, mileageProfileFrom, MILEAGE_RATES } from "../src/lib/mileage.js";

describe("C692 — the IRS rates", () => {
  it("2024 67¢, 2025 70¢, 2026 72.5¢ then 76¢ from July 1", () => {
    expect(MILEAGE_RATES[2024]).toEqual([{ from: "2024-01-01", rate: 0.67 }]);
    expect(MILEAGE_RATES[2025]).toEqual([{ from: "2025-01-01", rate: 0.70 }]);
    expect(MILEAGE_RATES[2026]).toEqual([{ from: "2026-01-01", rate: 0.725 }, { from: "2026-07-01", rate: 0.76 }]);
  });
  it("a year with no published rate uses the latest", () => {
    expect(mileageRatesFor(2027)).toEqual([{ from: "2027-01-01", rate: 0.76 }]);
    expect(mileageRatesFor(2020)).toEqual([{ from: "2020-01-01", rate: 0.67 }]);
  });
});

describe("C692 — the deduction", () => {
  it("one rate", () => {
    expect(mileageDeduction({ year: 2025, miles: 10000 })).toMatchObject({ amount: 7000, assumedSplit: false });
    expect(mileageDeduction({ year: 2025, miles: 0 }).amount).toBe(0);
    expect(mileageDeduction({ year: 2025, miles: -5 }).amount).toBe(0);
  });
  it("2026 with the July miles given", () => {
    expect(mileageDeduction({ year: 2026, miles: 10000, milesAfterChange: 4000 })).toMatchObject({ amount: 6000 * 0.725 + 4000 * 0.76, before: 6000, after: 4000, assumedSplit: false });
    expect(mileageDeduction({ year: 2026, miles: 10000, milesAfterChange: 20000 }).after).toBe(10000);   // never more than the total
  });
  it("2026 without it: spread evenly by days (184 of 365 after July 1)", () => {
    const d = mileageDeduction({ year: 2026, miles: 10000 });
    expect(d.after).toBe(Math.round(10000 * 184 / 365));
    expect(d.amount).toBe(Math.round(((10000 - d.after) * 0.725 + d.after * 0.76) * 100) / 100);
    expect(d.assumedSplit).toBe(true);
  });
});

describe("C692 — parking and tolls still count", () => {
  for (const v of ["SpotHero", "Downtown Parking Garage", "E-ZPass", "TxTag tolls", "ParkMobile"]) it(v, () => expect(isParkingOrToll({ vendor: v })).toBe(true));
  for (const v of ["Shell", "Jiffy Lube", "GEICO", "Texas DMV"]) it(`${v} is replaced by the rate`, () => expect(isParkingOrToll({ vendor: v })).toBe(false));
});

describe("C692 — saved with the year's tax settings", () => {
  it("reads business_miles and the after-change miles", () => {
    expect(mileageProfileFrom({})).toEqual({ miles: 0, milesAfterChange: null });
    expect(mileageProfileFrom({ business_miles: "8200.7", business_miles_after_change: 3000 })).toEqual({ miles: 8200, milesAfterChange: 3000 });
  });
});

import { scheduleCBreakdown } from "../src/lib/taxGuidance.js";
import { taxEstimate } from "../src/lib/tax.js";
import { readFileSync } from "node:fs";
describe("C692 — on the tax lines", () => {
  const chart = [{ code: "6450", name: "Vehicle Expenses", system_role: "vehicle_expenses" }];
  const row = (amount, vendor) => ({ gl_code: "6450", amount, vendor, date: "2025-05-01", status: "posted" });
  const led = [row(1200, "Shell"), row(800, "Jiffy Lube"), row(60, "SpotHero")];
  it("the mileage rate replaces gas and repairs; parking stays on top", () => {
    const sc = scheduleCBreakdown(led, 2025, { chart, mileage: { miles: 5000 } });
    const car = sc.rows.find((r) => r.line === "9");
    expect(car.deductible).toBe(5000 * 0.70 + 60);
    expect(car.spent).toBe(2060);
    expect(car.mileage).toMatchObject({ amount: 3500, replaced: 2000, actual: 2060 });
    expect(sc.notDeductible).toBe(0);   // replaced costs aren't "not deductible" — the rate covers them
  });
  it("even when the rate gives less than the booked costs, the replaced costs aren't called 'not deductible'", () => {
    const sc = scheduleCBreakdown(led, 2025, { chart, mileage: { miles: 1000 } });
    expect(sc.rows.find((r) => r.line === "9").deductible).toBe(760);
    expect(sc.notDeductible).toBe(0);
  });
  it("no miles → the booked costs, as before; a corporation → as before", () => {
    expect(scheduleCBreakdown(led, 2025, { chart }).rows.find((r) => r.line === "9").deductible).toBe(2060);
    expect(scheduleCBreakdown(led, 2025, { chart, legalForm: "s_corp", mileage: { miles: 5000 } }).rows.find((r) => r.line === "9").deductible).toBe(2060);
  });
  it("miles with no car costs booked still deduct", () => {
    expect(scheduleCBreakdown([], 2025, { chart, mileage: { miles: 1000 } }).deductibleTotal).toBe(700);
  });
  it("the estimate reads the miles from the profile", () => {
    const rev = { gl_code: "4000", amount: 50000, debit_credit: "credit", date: "2025-02-01", status: "posted" };
    expect(taxEstimate([rev], 2025, 0, { businessMiles: 10000 }).deductible).toBe(7000);
  });
  it("the Taxes screen asks for the miles, and the July miles where the year has a change", () => {
    const tax = readFileSync("src/components/views/TaxView.jsx", "utf8");
    expect(tax).toMatch(/data-mileage/);
    expect(tax).toMatch(/business_miles: v/);
    expect(tax).toMatch(/business_miles_after_change: v/);
    expect(tax).toMatch(/mileageRates\.length > 1 &&/);
  });
});
