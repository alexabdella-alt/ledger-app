// C723 — equipment: removing its purchase removes the wear and tear already recorded; an improvement
// to leased space is spread over the lease.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { postedDepreciationFor, leaseholdLifeMonths } from "../src/lib/depreciation.js";

const dep = (id, asset, extra = {}) => ({ id, db_entry_id: id, date: "2026-03-31", amount: 200, import_metadata: { kind: "depreciation", asset_id: asset, period: 1 }, status: "booked", ...extra });

describe("★ the depreciation recorded for assets that are going", () => {
  it("live, stamped, theirs, once per entry", () => {
    const ledger = [
      dep("d1", "A"), dep("d2", "A"), dep("d3", "B"),
      dep("d4", "A", { deleted_at: "x" }), dep("d5", "A", { reversed_by: "r" }),
      { id: "d6_0", db_entry_id: "d6", import_metadata: { kind: "depreciation", asset_id: "A" } }, { id: "d6_1", db_entry_id: "d6", import_metadata: { kind: "depreciation", asset_id: "A" } },
      { id: "x", import_metadata: { kind: "payroll" } },
    ];
    expect(postedDepreciationFor(ledger, ["A"]).map((i) => i.id)).toEqual(["d1", "d2", "d6_0"]);
    expect(postedDepreciationFor(ledger, [])).toEqual([]);
  });
  it("removing a purchase removes them — deleted in an open month, corrected in a signed one — and says so", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/const rows = postedDepreciationFor\(invoicesRef\.current \|\| \[\], \(assets \|\| \[\]\)\.map\(a => a\.id\)\);/);
    expect(app).toMatch(/if \(signedPeriodForDate\(d\.date, signoffs\)\) \{\s*const r = await reverseJournalEntry\(d,/);
    expect(app).toMatch(/label: "asset-removed:depreciation"/);
    expect((app.match(/await removeAssetDepreciation\(invoice\);   \/\/ C723/g) || []).length).toBe(2);   // both ways of removing
    expect(app).toMatch(/of wear and tear already recorded for/);
  });
});

describe("★ an improvement to leased space is spread over the lease", () => {
  it("the shorter of the lease left and 15 years; 15 years with no lease on file", () => {
    const lease = (end, extra = {}) => ({ contract_type: "lease", end_date: end, ...extra });
    expect(leaseholdLifeMonths([], "2026-11-13")).toBe(180);
    expect(leaseholdLifeMonths([lease("2029-11-12")], "2026-11-13")).toBe(36);
    expect(leaseholdLifeMonths([lease("2029-11-13")], "2026-11-13")).toBe(37);
    expect(leaseholdLifeMonths([lease("2050-01-01")], "2026-11-13")).toBe(180);
    expect(leaseholdLifeMonths([lease("2025-01-01"), lease("2027-11-12", { deleted_at: "x" }), { contract_type: "subscription_paid", end_date: "2030-01-01" }], "2026-11-13")).toBe(180);
  });
  it("the option books it as equipment with a schedule", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/label:"Permanent improvement to a space I LEASE", gl_code:rc\("fixed_assets"\), gl_name:rn\("fixed_assets"\), depreciate:true,\s*usefulLifeMonths: leaseholdLifeMonths\(contracts, todayLocal\(\)\),/);
  });
});
