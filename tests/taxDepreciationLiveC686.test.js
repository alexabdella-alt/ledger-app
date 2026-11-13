// C686 — tax depreciation counts only equipment the books still hold (review of C683).
import { describe, it, expect } from "vitest";
import { taxDepreciationFor } from "../src/lib/taxGuidance.js";
import { taxEstimate } from "../src/lib/tax.js";
import { readFileSync } from "node:fs";

const asset = (over = {}) => ({ id: "a1", cost: 10000, in_service_date: "2026-03-01", useful_life_months: 60, source_journal_entry_id: "je-buy", ...over });
const buy = (over = {}) => ({ id: "je-buy", db_entry_id: "je-buy", entry_date: "2026-03-01", gl_code: "1500", amount: 10000, status: "posted", ...over });
const dep = (over = {}) => ({ id: "je-dep", db_entry_id: "je-dep", entry_date: "2026-03-31", gl_code: "6900", amount: 166.67, status: "posted", ...over });
const posted = [{ asset_id: "a1", period_date: "2026-03-31", amount: 166.67, journal_entry_id: "je-dep" }];

describe("C686 — a deleted or corrected purchase gets no tax deduction", () => {
  it("a live purchase is fully deducted (100% bonus after 2025-01-19)", () => {
    expect(taxDepreciationFor({ assets: [asset()], posted, year: 2026, ledger: [buy(), dep()] })).toEqual({ tax: 10000, bookTracked: 166.67 });
  });
  it("a purchase that was deleted, voided or reversed is not", () => {
    for (const gone of [buy({ status: "deleted" }), buy({ status: "voided" }), buy({ reversed_by: "je-rev" }), buy({ deleted_at: "2026-04-01" })]) {
      expect(taxDepreciationFor({ assets: [asset()], posted, year: 2026, ledger: [gone, dep()] })).toEqual({ tax: 0, bookTracked: 0 });
    }
    expect(taxDepreciationFor({ assets: [asset()], posted, year: 2026, ledger: [dep()] }).tax).toBe(0);   // purchase entry gone entirely
  });
  it("a deleted asset row is not", () => {
    expect(taxDepreciationFor({ assets: [asset({ deleted_at: "2026-04-01" })], posted, year: 2026, ledger: [buy(), dep()] }).tax).toBe(0);
  });
  it("a voided depreciation entry is not subtracted from the books' figure", () => {
    expect(taxDepreciationFor({ assets: [asset()], posted, year: 2026, ledger: [buy(), dep({ status: "voided" })] }).bookTracked).toBe(0);
  });
  it("an older asset with no recorded purchase still counts", () => {
    expect(taxDepreciationFor({ assets: [asset({ source_journal_entry_id: null })], posted: [], year: 2026, ledger: [] }).tax).toBe(10000);
  });
  it("the estimate passes the ledger through", () => {
    const withLive = taxEstimate([buy()], 2026, 0, { assets: { assets: [asset()], posted: [] } });
    const withGone = taxEstimate([buy({ status: "deleted" })], 2026, 0, { assets: { assets: [asset()], posted: [] } });
    expect(withLive.deductible - withGone.deductible).toBe(10000);
  });
  it("the app loads only undeleted assets with their purchase and the depreciation entry", () => {
    const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
    expect(src).toMatch(/from\("fixed_assets"\)\.select\("id, cost, in_service_date, useful_life_months, status, source_journal_entry_id, vendor, description"\)\.eq\("company_id", cid\)\.is\("deleted_at", null\)/);
    expect(src).toMatch(/from\("depreciation_schedule"\)\.select\("asset_id, period_date, amount, journal_entry_id"\)/);
  });
});
