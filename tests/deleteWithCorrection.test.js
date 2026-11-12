import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// C602 — review findings B4 and B10, both in the one function every delete path goes through.
const app = readFileSync("src/App.jsx", "utf8");
const fn = app.slice(app.indexOf("const softDeleteJournalEntry = async"), app.indexOf("// Restore soft-deleted journal entries"));

describe("B4 — a deleted entry takes its correction with it", () => {
  it("★ live corrections pointing at the deleted entries are found and removed through the same checked write", () => {
    expect(fn).toMatch(/\.in\("import_metadata->>reverses", deleted\)\s*\n\s*\.is\("deleted_at", null\)\.eq\("status", "posted"\);\s*\n\s*for \(const r of \(revs \|\| \[\]\)\) if \(!ids\.map\(String\)\.includes\(String\(r\.id\)\)\) await mark\(r\.id\);/);
  });
  it("★ it runs before the screen is updated and the result returned, so Undo restores both", () => {
    const corr = fn.indexOf('.in("import_metadata->>reverses", deleted)');
    expect(corr).toBeGreaterThan(-1);
    expect(corr).toBeLessThan(fn.indexOf("if (ids.length) {\n      const idset"));
    expect(corr).toBeLessThan(fn.lastIndexOf("return ids;"));
  });
  it("a failed check is recorded, not swallowed", () => {
    expect(fn).toMatch(/logAudit\("delete_correction_left_behind"/);
  });
  it("corrections are stored under the key it reads", () => {
    expect(app).toMatch(/p_meta: \{ kind: "reversal", reverses: String\(origId\) \}/);
  });
});

describe("B10 — the unsaved-entry fallback deletes one entry or none", () => {
  it("★ exactly one match is deleted; several are refused and said", () => {
    expect(fn).toMatch(/if \(matches\?\.length === 1\) await mark\(matches\[0\]\.id\);/);
    expect(fn).not.toMatch(/for \(const m of matches\) await mark\(m\.id\)/);
    expect(fn).toMatch(/logAudit\("delete_ambiguous_refused"/);
    expect(fn).toMatch(/so nothing was deleted\. Reload the page and try again\./);
  });
});
