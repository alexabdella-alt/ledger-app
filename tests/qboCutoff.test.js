import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { splitQboRowsAtCutoff, qboBeforeCutoffCopy } from "../src/lib/qboCutoff";

// C596 — review finding F4: the QuickBooks import ignored the start date.
const rows = [{ date: "2025-12-31", amount: 10 }, { date: "2026-01-01", amount: 20 }, { date: "2026-02-03", amount: 30 }, { date: "", amount: 40 }];

describe("rows before the start date are set aside", () => {
  it("★ before the start date out; on it and after, in", () => {
    const { keep, before } = splitQboRowsAtCutoff(rows, "2026-01-01");
    expect(before.map((r) => r.amount)).toEqual([10]);
    expect(keep.map((r) => r.amount)).toEqual([20, 30, 40]);
  });

  it("no start date → nothing set aside (the legacy warn-only rule)", () => {
    expect(splitQboRowsAtCutoff(rows, null).before).toEqual([]);
  });

  it("says how many and why, or nothing at all", () => {
    expect(qboBeforeCutoffCopy(1, "2026-01-01")).toBe("1 row is dated before your start date (2026-01-01) and won't be imported — that history is already in your starting balances, so importing it would count it twice.");
    expect(qboBeforeCutoffCopy(1200, "2026-01-01")).toMatch(/^1,200 rows are dated before/);
    expect(qboBeforeCutoffCopy(0, "2026-01-01")).toBeNull();
    expect(qboBeforeCutoffCopy(3, null)).toBeNull();
  });
});

describe("the import", () => {
  const v = readFileSync("src/components/views/QBOImportView.jsx", "utf8");
  const run = v.slice(v.indexOf("const runImport = async"), v.indexOf("setResult({ imported"));

  it("★ the rows it books are the ones on or after the start date — split before anything is written", () => {
    expect(run).toMatch(/const \{ keep: rows, before: beforeStart \} = splitQboRowsAtCutoff\(parsed\.rows, cutoffDate\);/);
    expect(run.indexOf("splitQboRowsAtCutoff(")).toBeLessThan(run.indexOf('.from("journal_entries").insert('));
    expect(run).not.toMatch(/const rows = parsed\.rows;/);
  });

  it("the set-aside rows are audited and counted in the summary", () => {
    expect(v).toMatch(/logAudit\("qbo_rows_before_start_date"/);
    expect(v).toMatch(/beforeStart: beforeStart\.length \}\);/);
    expect(v).toMatch(/\["Before your start date", result\.beforeStart\.toLocaleString\(\)\]/);
  });

  it("the preview warns, and the button counts only what will be imported", () => {
    expect(v).toMatch(/qboBeforeCutoffCopy\(splitQboRowsAtCutoff\(parsed\.rows, cutoffDate\)\.before\.length, cutoffDate\)/);
    expect(v).toMatch(/Import \{splitQboRowsAtCutoff\(parsed\.rows, cutoffDate\)\.keep\.length\.toLocaleString\(\)\} transactions/);
  });
});
