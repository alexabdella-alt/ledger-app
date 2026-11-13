import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { planDepreciationAutoPost, sourcePurchaseLive } from "../src/lib/depreciation";

// C600 — review finding B2: depreciation kept posting after the capitalised purchase was
// deleted or corrected.
const ledger = [
  { id: "buy1_0", db_entry_id: "buy1", status: "booked" },
  { id: "buy2_0", db_entry_id: "buy2", status: "booked", reversed_by: "rev9" },
];
const row = (asset, src, idx = 1) => ({ id: `${asset}-${idx}`, asset_id: asset, period_index: idx, period_date: "2026-03-31", amount: 100, status: "pending", fixed_assets: { vendor: asset, source_journal_entry_id: src } });

describe("only an asset whose purchase is still in the books is depreciated", () => {
  it("live purchase → posts", () => {
    expect(planDepreciationAutoPost([row("oven", "buy1")], ledger, "2026-11-12").post).toHaveLength(1);
  });

  it("★ a removed purchase → held back, not posted, and the asset is never marked finished", () => {
    const p = planDepreciationAutoPost([row("van", "gone")], ledger, "2026-11-12");
    expect(p.post).toHaveLength(0);
    expect(p.orphaned.map((r) => r.asset_id)).toEqual(["van"]);
    expect(p.assetsToFlip).toEqual([]);
  });

  it("★ a reversed purchase → held back", () => {
    expect(planDepreciationAutoPost([row("mixer", "buy2")], ledger, "2026-11-12").orphaned).toHaveLength(1);
  });

  it("an older asset with no recorded purchase is unchanged", () => {
    expect(planDepreciationAutoPost([row("old", null)], ledger, "2026-11-12").post).toHaveLength(1);
    expect(sourcePurchaseLive(ledger, null)).toBe(true);
  });

  it("voided and deleted purchases are not live", () => {
    expect(sourcePurchaseLive([{ id: "x", db_entry_id: "x", status: "voided" }], "x")).toBe(false);
    expect(sourcePurchaseLive([{ id: "x", db_entry_id: "x", deleted_at: "t" }], "x")).toBe(false);
    expect(sourcePurchaseLive([{ id: "x_1" }], "x")).toBe(true);   // the flatten's id carries the entry
  });
});

describe("the auto-post", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  const fn = app.slice(app.indexOf("const autoPostDepreciation = async"), app.indexOf("let posted = 0;", app.indexOf("const autoPostDepreciation = async")));
  it("★ reads the asset's source purchase and says what it held back", () => {
    expect(fn).toMatch(/fixed_assets!inner\([^)]*source_journal_entry_id, status\)/);   // C724 — and its status, so a disposed asset stops
    expect(fn).toMatch(/const \{ post, incomplete, assetsToFlip, orphaned \} = planDepreciationAutoPost\(rows, ledger, today\);/);
    expect(fn).toMatch(/logAudit\("depreciation_held_source_removed"/);
    expect(fn).toMatch(/if \(!depreciationHoldToldRef\.current\) \{\s*\n\s*depreciationHoldToldRef\.current = true;\s*\n\s*showNotification\(`We've stopped spreading the cost of/);
  });
});
