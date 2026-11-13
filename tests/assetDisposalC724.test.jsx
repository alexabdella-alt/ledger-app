// C724 — selling or getting rid of equipment.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildAssetDisposalEntry } from "../src/lib/depreciation.js";
import { taxDepreciationFor } from "../src/lib/taxGuidance.js";

const base = { cost: 12000, accumulated: 1200, date: "2026-11-13", assetCode: "1500", accumDepCode: "1510", cashCode: "1000", gainLossCode: "8200" };
const by = (e) => Object.fromEntries(e.lines.map((l) => [l.code, Math.round((l.debit - l.credit) * 100) / 100]));

describe("★ the entry (§12: exact debits and credits, only the gain or loss moves profit)", () => {
  it("sold for less than its value in the books: a loss", () => {
    const e = buildAssetDisposalEntry({ ...base, proceeds: 9000 });
    expect(e.balanced).toBe(true);
    expect(by(e)).toEqual({ "1000": 9000, "1510": 1200, "1500": -12000, "8200": 1800 });
  });
  it("sold for more: a gain (a credit to the gain/loss account)", () => {
    expect(by(buildAssetDisposalEntry({ ...base, proceeds: 11500 }))).toEqual({ "1000": 11500, "1510": 1200, "1500": -12000, "8200": -700 });
  });
  it("scrapped: no money in, the rest of its value is the loss", () => {
    expect(by(buildAssetDisposalEntry({ ...base, proceeds: 0 }))).toEqual({ "1510": 1200, "1500": -12000, "8200": 10800 });
  });
  it("exactly its value in the books: no gain or loss line", () => {
    expect(by(buildAssetDisposalEntry({ ...base, proceeds: 10800 }))).toEqual({ "1000": 10800, "1510": 1200, "1500": -12000 });
  });
  it("assets fall by its book value minus what came in; profit moves by the gain or loss only", () => {
    for (const proceeds of [0, 500, 10800, 13000]) {
      const b = by(buildAssetDisposalEntry({ ...base, proceeds }));
      const assets = (b["1000"] || 0) + (b["1510"] || 0) + (b["1500"] || 0);
      expect(Math.round(assets * 100) / 100).toBe(Math.round((proceeds - (12000 - 1200)) * 100) / 100);
      expect(-(b["8200"] || 0) + 0).toBe(Math.round((proceeds - 10800) * 100) / 100 + 0);   // (+0: no gain line reads -0)
    }
  });
  it("nothing it can't stand behind: no cost, wear and tear above cost, money in with no account", () => {
    expect(buildAssetDisposalEntry({ ...base, cost: 0, proceeds: 1 })).toBe(null);
    expect(buildAssetDisposalEntry({ ...base, accumulated: 13000 })).toBe(null);
    expect(buildAssetDisposalEntry({ ...base, cashCode: null, proceeds: 5 })).toBe(null);
    expect(buildAssetDisposalEntry({ ...base, accumDepCode: null })).toBe(null);
  });
});

describe("★ the app", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  it("accumulated = the wear and tear recorded; never dated before it; disposed assets stop", () => {
    expect(app).toMatch(/const posted = postedDepreciationFor\(invoicesRef\.current \|\| \[\], \[asset\.id\]\);/);
    expect(app).toMatch(/if \(lastPosted && String\(date\) < lastPosted\) \{/);
    expect(app).toMatch(/patch: \{ status: "disposed" \}, label: "asset-disposal:status"/);
    expect(app).toMatch(/rows = \(data \|\| \[\]\)\.filter\(r => !\(r\.fixed_assets && r\.fixed_assets\.status === "disposed"\)\);/);
    expect(app).toMatch(/const jeId = await persistMultiLineEntry\(je\);\s*if \(!jeId\) return \{ ok: false \};/);
  });
  it("the panel offers it on an equipment purchase only, to someone who can record it", () => {
    const p = readFileSync("src/components/TransactionDetailPanel.jsx", "utf8");
    expect(p).toMatch(/\{!isViewer && disposeAsset && !reversedInfo && sel\.source !== "opening_balance" && String\(sel\.gl_code\) === String\(getAccountByRole\?\.\("fixed_assets"\)\?\.code\) && \(/);
    expect(p).toMatch(/>Sold or got rid of it<\/button>/);
  });
});

describe("★ the tax estimate", () => {
  it("a disposed asset adds no tax depreciation and subtracts none of its book wear and tear", () => {
    const a = { id: "A", cost: 12000, in_service_date: "2026-01-15", useful_life_months: 60 };
    const posted = [{ asset_id: "A", period_date: "2026-02-15", amount: 200 }];
    expect(taxDepreciationFor({ assets: [{ ...a, status: "disposed" }], posted, year: 2026 })).toEqual({ tax: 0, bookTracked: 0 });
    expect(taxDepreciationFor({ assets: [a], posted, year: 2026 }).bookTracked).toBe(200);
  });
});
