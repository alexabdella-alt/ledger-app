// C699 — one spreadsheet for the tax preparer, from the Taxes screen's own figures.
import { describe, it, expect } from "vitest";
import { taxPacketRows, taxPacketFilename, TAX_PACKET_HEADERS } from "../src/lib/taxPacket.js";
import { taxEstimate, deductionBreakdown, taxProfileFrom } from "../src/lib/tax.js";
import { toCSV } from "../src/lib/insights.js";
import { readFileSync } from "node:fs";

const chart = [{ code: "6400", name: "Travel & Entertainment", system_role: "travel_entertainment" }, { code: "6450", name: "Vehicle Expenses", system_role: "vehicle_expenses" }, { code: "6800", name: "Professional Services", system_role: "professional_services" }];
const led = [
  { gl_code: "4000", amount: 60000, debit_credit: "credit", date: "2025-02-01", status: "posted" },
  { gl_code: "6400", amount: 200, vendor: "Corner Bistro", date: "2025-03-01", status: "posted" },
  { gl_code: "6450", amount: 900, vendor: "Shell", date: "2025-04-01", status: "posted" },
  { gl_code: "6800", amount: 3000, vendor: "Jo Design", date: "2025-05-01", status: "posted" },
];
const profile = taxProfileFrom({ filing_status: "single", home_office_sqft: 150, business_miles: 4000 });
const est = taxEstimate(led, 2025, 1200, { chart, ...profile });
const deductions = deductionBreakdown(led, 2025, null, { chart, ...profile });
const rows = taxPacketRows({ year: 2025, companyName: "Jo's Studio", legalForm: "sole_prop", profile, est, deductions,
  assets: [{ cost: 3200, in_service_date: "2025-06-01", description: "Camera" }, { cost: 999, in_service_date: "2024-06-01", description: "Old laptop" }],
  estPaid: 1200, form1099: [{ name: "Jo Design", paid: 3000, reportable: 3000, status: { key: "needs" } }, { name: "Shell", paid: 900, status: { key: "none" } }], preparedOn: "Nov 13, 2026" });
const find = (section, item) => rows.find((r) => r[0] === section && r[1] === item);

describe("C699 — the summary", () => {
  it("says what it is", () => {
    expect(find("About", "Tax year")[3]).toBe("2025");
    expect(find("About", "Prepared")[3]).toMatch(/not a tax return/);
    expect(find("About", "Filing status")[3]).toBe("Single");
  });
  it("income and spending by tax-form line, from the Taxes screen's figures", () => {
    expect(find("Income", "Money that came in (sales and other income)")[2]).toBe(60000);
    expect(find("Deductible spending", "Business meals (50% counts)")[2]).toBe(100);
    expect(find("Deductible spending", "Business meals (50% counts)")[3]).toMatch(/100 of 200 spent doesn't count/);
    expect(find("Deductible spending", "Car and truck")[2]).toBe(2800);   // 4,000 miles × 70¢ replaces the $900 of gas
    expect(find("Deductible spending", "Home office")).toBeUndefined();   // its own section, not twice
  });
  it("home office, car, equipment bought THIS year, payments, 1099s", () => {
    expect(find("Home office", "Deduction")[2]).toBe(750);
    expect(find("Car", "Business miles")[2]).toBe(4000);
    expect(find("Car", "Car costs recorded in the books")[2]).toBe(900);
    expect(find("Equipment bought", "Camera")[2]).toBe(3200);
    expect(find("Equipment bought", "Old laptop")).toBeUndefined();
    expect(find("Estimated tax", "Estimated payments you told us you made")[2]).toBe(1200);
    expect(find("Estimated tax", "Total federal (estimate)")[2]).toBe(est.total);
    expect(find("1099s", "Jo Design")[3]).toMatch(/needs a 1099/);
    expect(find("1099s", "Shell")).toBeUndefined();
  });
  it("a corporation: no filing status, no SE tax, no home office line", () => {
    const c = taxPacketRows({ year: 2025, legalForm: "c_corp", profile: { homeOfficeSqft: 200 }, est: { total: 100, federal: 100 }, deductions: [] });
    expect(c.find((r) => r[1] === "Filing status")).toBeUndefined();
    expect(c.find((r) => r[1] === "Self-employment tax (estimate)")).toBeUndefined();
    expect(c.find((r) => r[0] === "Home office")).toBeUndefined();
  });
  it("a vendor name can't run as a spreadsheet formula", () => {
    const evil = taxPacketRows({ year: 2025, form1099: [{ name: "=HYPERLINK(\"x\")", paid: 3000, status: { key: "needs" } }] });
    expect(toCSV(TAX_PACKET_HEADERS, evil)).toMatch(/'=HYPERLINK/);
  });
  it("a plain file name", () => {
    expect(taxPacketFilename("Jo's Studio!", 2025)).toBe("jo-s-studio-tax-summary-2025.csv");
  });
});

describe("C699 — on the Taxes screen", () => {
  it("a download with a year, reading that year's own answers", () => {
    const tax = readFileSync("src/components/views/TaxView.jsx", "utf8");
    expect(tax).toMatch(/data-tax-packet/);
    expect(tax).toMatch(/\.select\("filed_deadlines, estimated_payments_made"\)/);
    expect(tax).toMatch(/downloadCSV\(taxPacketFilename\(currentCompany\?\.name, packetYear\), TAX_PACKET_HEADERS, rows\)/);
  });
});
