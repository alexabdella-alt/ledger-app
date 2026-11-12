import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// C604 — review findings B7 and B9.
const app = readFileSync("src/App.jsx", "utf8");

describe("B9 — a failed Undo never ends in a success message", () => {
  it("★ every Undo handler returns after its failure toast, before its ✓", () => {
    // Each failure sentence that says the undo did not happen is followed by `return;`.
    const fails = [...app.matchAll(/showNotification\("Couldn't undo that[^"]*", "error"\);\s*\n(\s*)(\S+)/g)];
    expect(fails.length).toBeGreaterThanOrEqual(2);
    for (const m of fails) expect(m[2]).toBe("return;");
  });
});

describe("B7 — an Undo that restored linked entries shows them", () => {
  const fn = app.slice(app.indexOf("const softDeleteInvoices = async"), app.indexOf("const softDeleteInvoice = (invoice"));
  it("★ when the restore covered entries outside the snapshot (a payment, a correction), the books are read again", () => {
    expect(fn).toMatch(/const snapBases = new Set\(restored\.map\(baseOf\)\);\s*\n\s*if \(allIds\.some\(id => !snapBases\.has\(String\(id\)\)\)\) \{ try \{ await loadAllData\(\); \} catch \{\} \}/);
    expect(fn.indexOf("const snapBases")).toBeGreaterThan(fn.indexOf("const ok = await restoreJournalEntries(allIds);"));
  });
});
