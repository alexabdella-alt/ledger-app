import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { computeVendorTotals } from "../src/lib/reports.js";
import { buildAliasIndex } from "../src/lib/vendorAlias.js";

// ═════════════════════════════════════════════════════════════════════════════
// C488 — THE BY VENDOR REPORT AND THE CHAT'S TOP-VENDORS TOOL SPLIT ONE SUPPLIER INTO TWO.
// `computeVendorTotals` grouped on the display name; the Vendors tab has grouped on the
// vendor KEY (through a confirmed alias) since C210/C317. One rule now, labelled by the
// most recent spelling.
// ═════════════════════════════════════════════════════════════════════════════
const row = (id, vendor, vendor_key, amount, date) => ({ id, vendor, vendor_key, amount, date, gl_code: "5010", gl_name: "Food Cost", type: "expense", debit_credit: "debit", secondary_gl_code: "2000", status: "posted" });
describe("C488", () => {
  it("two spellings of one supplier are one row, labelled by the latest spelling", () => {
    const rows = [row("a", "Hill Country Milling Co.", "hill country milling", 100, "2026-01-05"), row("b", "Hill Country Milling", "hill country milling", 250, "2026-03-05")];
    const v = computeVendorTotals(rows);
    expect(v).toHaveLength(1);
    expect(v[0].vendor).toBe("Hill Country Milling");
    expect(v[0].total).toBe(350);
  });
  it("a confirmed alias joins two keys", () => {
    const idx = buildAliasIndex([{ name: "Franklin Ave Properties", aliases: ["Franklin Ave Properties LP Rent"] }]);
    const rows = [row("a", "Franklin Ave Properties", "franklin ave properties", 2400, "2026-01-01"), row("b", "FRANKLIN AVE PROPERTIES LP RENT", "franklin ave properties rent", 2400, "2026-02-01")];
    expect(computeVendorTotals(rows, {}, { aliasIndex: idx })).toHaveLength(1);
    expect(computeVendorTotals(rows)).toHaveLength(2);   // without the alias they stay apart — no string surgery
  });
  it("the report and the AI ctx hand the alias index in", () => {
    expect(fs.readFileSync("src/components/views/ReportsView.jsx", "utf8")).toMatch(/computeVendorTotals\(filtered, \{\}, \{ aliasIndex \}\)/);
    expect(fs.readFileSync("src/lib/aiTools.js", "utf8")).toMatch(/computeVendorTotals\(await ctx\.getLedger\(\), \{ from, to \}, \{ aliasIndex: ctx\.aliasIndex \|\| null \}\)/);
    expect(fs.readFileSync("src/lib/ai.js", "utf8")).toMatch(/cashBalance, anomalies, recurring, aliasIndex,/);
    expect(fs.readFileSync("src/App.jsx", "utf8")).toMatch(/getAccountByRole, recurring, aliasIndex,\s*\n\s*onToolCall:/);
  });
});
