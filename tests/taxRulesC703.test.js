// C703 — rule errors from the whole-area review: home office cap, mileage vs. car depreciation,
// QuickBooks car names, a partner's share, the owner's health insurance / retirement in the books.
import { describe, it, expect } from "vitest";
import { scheduleCBreakdown, federalEstimate, taxDepreciationFor, lineForAccount } from "../src/lib/taxGuidance.js";
import { taxEstimate, deductionBreakdown, taxProfileFrom } from "../src/lib/tax.js";
import { paymentKindForAccount, PAYMENT_KIND } from "../src/lib/form1099.js";
import { readFileSync } from "node:fs";
import { mileageDeduction } from "../src/lib/mileage.js";

const rev = (amount, date = "2026-03-01") => ({ gl_code: "4000", amount, debit_credit: "credit", date, status: "posted" });
const spend = (code, amount, vendor = "x") => ({ gl_code: code, amount, vendor, date: "2026-04-01", status: "posted" });

describe("C703 — the home office can't exceed what the business made (Rev. Proc. 2013-13 §4.03)", () => {
  it("no income → no home office; some income → capped after the other costs", () => {
    expect(scheduleCBreakdown([], 2026, { homeOfficeSqft: 300, grossIncome: 0 }).homeOffice).toBe(0);
    const chart = [{ code: "6800", name: "Professional Services", system_role: "professional_services" }];
    expect(scheduleCBreakdown([spend("6800", 700)], 2026, { chart, homeOfficeSqft: 300, grossIncome: 1000 }).homeOffice).toBe(300);
    expect(scheduleCBreakdown([], 2026, { homeOfficeSqft: 300, grossIncome: 5000 }).homeOffice).toBe(1500);
  });
  it("the estimate no longer shows a 'saving' from a home office with no income", () => {
    const e = taxEstimate([], 2026, 0, { homeOfficeSqft: 300, ownWages: 80000 });
    expect(e.federal).toBe(0);
    expect(e.deductible).toBe(0);
  });
});

describe("C703 — the mileage rate already includes the car's depreciation (Rev. Proc. 2019-46)", () => {
  const assets = [{ id: "a1", cost: 40000, in_service_date: "2026-02-01", useful_life_months: 60, description: "2026 Toyota RAV4" },
                  { id: "a2", cost: 3000, in_service_date: "2026-02-01", useful_life_months: 60, description: "Camera" }];
  it("a vehicle gets no tax depreciation when miles are used; other equipment still does", () => {
    expect(taxDepreciationFor({ assets, year: 2026 }).tax).toBe(43000);
    expect(taxDepreciationFor({ assets, year: 2026, mileageRate: true }).tax).toBe(3000);
  });
  it("in the estimate: miles on → the car isn't deducted twice", () => {
    const off = taxEstimate([rev(100000)], 2026, 0, { assets: { assets, posted: [] } });
    const on = taxEstimate([rev(100000)], 2026, 0, { assets: { assets, posted: [] }, businessMiles: 10000 });
    expect(off.deductible).toBe(43000);
    expect(on.deductible).toBe(Math.round((3000 + mileageDeduction({ year: 2026, miles: 10000 }).amount) * 100) / 100);
  });
  it("QuickBooks' car names are the car (line 9), so the mileage rate replaces them", () => {
    for (const n of ["Automobile", "Auto Expense", "Auto Insurance", "Automobile:Fuel"]) expect(lineForAccount({ name: n }).line).toBe("9");
    expect(lineForAccount({ name: "Autodesk" }).line).not.toBe("9");
  });
});

describe("C703 — a partner pays tax on their share", () => {
  it("50% share → the tax on half the profit", () => {
    const whole = federalEstimate({ revenue: 100000, year: 2026, legalForm: "partnership" });
    const half = federalEstimate({ revenue: 100000, year: 2026, legalForm: "partnership", ownerShare: 0.5 });
    expect(half.profit).toBe(50000);
    expect(half.seTax).toBeCloseTo(whole.seTax / 2, 1);
    expect(federalEstimate({ revenue: 100000, year: 2026, legalForm: "sole_prop", ownerShare: 0.5 }).profit).toBe(100000);   // a sole proprietor owns it all
  });
  it("saved as a percentage; unset → all of it, said on screen", () => {
    expect(taxProfileFrom({ owner_share: 50 })).toMatchObject({ ownerShare: 0.5, ownerShareAssumed: false });
    expect(taxProfileFrom({})).toMatchObject({ ownerShare: 1, ownerShareAssumed: true });
    const tax = readFileSync("src/components/views/TaxView.jsx", "utf8");
    expect(tax).toMatch(/Your share of the profit \(%\)/);
    expect(tax).toMatch(/We've assumed you own all of the business/);
  });
});

describe("C703 — the owner's health insurance / retirement in the books", () => {
  const chart = [{ code: "6710", name: "Health Insurance" }, { code: "6720", name: "SEP IRA Contributions" }, { code: "6000", name: "Salaries & Wages", system_role: "salaries_wages" }];
  it("no employees: on the personal return — not Schedule C, not cutting SE tax — and in the estimate", () => {
    const led = [rev(80000), spend("6710", 6000), spend("6720", 5000)];
    const sc = scheduleCBreakdown(led, 2026, { chart });
    expect(sc.ownerHealth).toBe(6000);
    expect(sc.ownerRetirement).toBe(5000);
    expect(sc.deductibleTotal).toBe(0);
    expect(sc.notDeductible).toBe(0);
    const e = taxEstimate(led, 2026, 0, { chart });
    expect(e.healthDeduction).toBe(6000);
    expect(e.seTax).toBe(Math.round(80000 * 0.9235 * 0.153 * 100) / 100);   // SE tax on the full profit
  });
  it("a figure typed on the Taxes screen wins — never both", () => {
    const led = [rev(80000), spend("6710", 6000)];
    expect(taxEstimate(led, 2026, 0, { chart, healthPremiums: 7000 }).healthDeduction).toBe(7000);
  });
  it("with employees: their benefits (lines 14 / 19)", () => {
    const sc = scheduleCBreakdown([rev(80000), spend("6000", 20000), spend("6710", 6000), spend("6720", 5000)], 2026, { chart });
    expect(sc.rows.find((r) => r.line === "14").deductible).toBe(6000);
    expect(sc.rows.find((r) => r.line === "19").deductible).toBe(5000);
    expect(sc.ownerHealth).toBe(0);
  });
  it("not a 1099 payment; the Taxes screen shows what the books hold", () => {
    expect(paymentKindForAccount({ name: "Health Insurance" })).toBe(PAYMENT_KIND.NOT_REPORTABLE);
    const d = deductionBreakdown([rev(80000), spend("6710", 6000)], 2026, null, { chart });
    expect(d.find((x) => x.key === "health").booked).toBe(6000);
    expect(readFileSync("src/components/views/TaxView.jsx", "utf8")).toMatch(/Your books show \{fmt\(d\.booked\)\} paid from the business for health insurance/);
  });
});
