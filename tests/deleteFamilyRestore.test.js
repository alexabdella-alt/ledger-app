import { describe, it, expect } from "vitest";
import fs from "node:fs";

// ═════════════════════════════════════════════════════════════════════════════
// C507 — UNDO PUT BACK ONE ROW OF A MULTI-LINE ENTRY. `softDeleteInvoices` snapshotted the
// rows it was handed (one per entry — the list shows one row per entry since C503) and its
// Undo, and its refused-delete restore, put back only those. A taxed invoice undone came back
// as its revenue row alone: A/R and the tax line gone from state, GL A/R short by the invoice
// until the next reload. The whole family (every row sharing the entry's db id) is
// snapshotted at delete time and restored together. Pinned in source: `softDeleteInvoices`
// lives in the ERP closure.
// ═════════════════════════════════════════════════════════════════════════════
describe("C507", () => {
  const src = fs.readFileSync("src/App.jsx", "utf8").replace(/^[ \t]*\/\/.*$/gm, "");
  const start = src.indexOf("const softDeleteInvoices = async (list, byAI=false) => {");
  const body = src.slice(start, src.indexOf("\n  const ", start + 50));
  it("snapshots the family before the optimistic removal and removes the family from state", () => {
    const fam = body.indexOf("const family = (invoicesRef.current || []).filter(i => i && bases.has(baseOf(i)))");
    const rm = body.indexOf("setInvoices(prev => prev.filter(i => !idset.has(String(i.id))));");
    expect(fam).toBeGreaterThan(-1); expect(rm).toBeGreaterThan(fam);
    expect(body).toMatch(/const idset = new Set\(family\.map\(s => String\(s\.id\)\)/);
  });
  it("every restore puts the family back — the all-refused, the partly-refused, and the Undo", () => {
    expect(body).toMatch(/\(family\.length \? family : snaps\)\.filter/);
    expect(body).toMatch(/const back = familyOf\(kept\.map\(r => r\.snap\)\)/);
    expect(body).toMatch(/const back = familyOf\(gone\.map\(r => r\.snap\)\);\s*const restored = back\.length \? back : gone\.map\(r => r\.snap\);/);
    expect(body).toMatch(/await resyncSettledFlags\(restored,/);
  });
});
