import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { capToolResult, TOOL_RESULT_MAX_CHARS } from "../src/lib/toolResultCap.js";

const row = (i) => ({ id: `e${i}`, date: "2026-03-01", vendor: `Vendor number ${i}`, amount: 100 + i, description: "x".repeat(200) });
const search = (n) => ({ count: n, total_count: n, total_amount: 12345.67, truncated: false, transactions: Array.from({ length: n }, (_, i) => row(i)) });

describe("C567 — a tool result that is too long is shortened by whole rows, and says so", () => {
  it("a result that fits is sent exactly as it was", () => {
    const out = search(3);
    expect(capToolResult(out)).toBe(JSON.stringify(out));
  });

  it("a result that does not fit is still well-formed JSON, within the limit", () => {
    const s = capToolResult(search(400));
    expect(s.length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS);
    expect(() => JSON.parse(s)).not.toThrow();
  });

  it("names the list, how many rows are shown and how many there were", () => {
    const r = JSON.parse(capToolResult(search(400)));
    expect(r._truncated.list).toBe("transactions");
    expect(r._truncated.of).toBe(400);
    expect(r._truncated.shown).toBe(r.transactions.length);
    expect(r._truncated.shown).toBeGreaterThan(0);
    expect(r._truncated.shown).toBeLessThan(400);
    expect(r._truncated.note).toMatch(/partial/);
  });

  it("keeps as many rows as fit — one more would not", () => {
    const max = 5000;
    const r = JSON.parse(capToolResult(search(100), max));
    const n = r._truncated.shown;
    const oneMore = { ...search(100), count: n + 1, transactions: search(100).transactions.slice(0, n + 1),
      _truncated: { ...r._truncated, shown: n + 1 } };
    expect(JSON.stringify(oneMore).length).toBeGreaterThan(max);
  });

  it("keeps the FIRST rows, in the tool's order (most recent first for a search)", () => {
    const r = JSON.parse(capToolResult(search(400)));
    expect(r.transactions[0].id).toBe("e0");
    expect(r.transactions.map(t => t.id)).toEqual(Array.from({ length: r.transactions.length }, (_, i) => `e${i}`));
  });

  it("totals computed over every row are left untouched", () => {
    const r = JSON.parse(capToolResult(search(400)));
    expect(r.total_amount).toBe(12345.67);
    expect(r.total_count).toBe(400);
  });

  it("a count that described the list now describes the shortened one", () => {
    const r = JSON.parse(capToolResult(search(400)));
    expect(r.count).toBe(r.transactions.length);
  });

  it("shortens the largest list, one level down too", () => {
    const out = { summary: { months: [1, 2, 3], vendors: Array.from({ length: 400 }, (_, i) => row(i)) } };
    const r = JSON.parse(capToolResult(out));
    expect(r._truncated.list).toBe("vendors");
    expect(r.summary.months).toEqual([1, 2, 3]);
  });

  it("a result with nothing to shorten is refused in words, never cut mid-text", () => {
    const s = capToolResult({ blob: "y".repeat(TOOL_RESULT_MAX_CHARS + 10) });
    const r = JSON.parse(s);
    expect(r.error).toMatch(/too large/);
    expect(r._truncated.shown).toBe(0);
  });

  it("when even an empty list would not fit, the result is refused rather than sent over the limit", () => {
    const s = capToolResult({ blob: "y".repeat(TOOL_RESULT_MAX_CHARS + 10), rows: [row(1), row(2)] });
    expect(s.length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS);
    expect(JSON.parse(s).error).toMatch(/too large/);
  });

  it("the chat's tool loop sends results through it, never a raw character cut", () => {
    const src = readFileSync("src/lib/ai.js", "utf8");
    expect(src).toMatch(/content: capToolResult\(out\)/);
    expect(src).not.toMatch(/JSON\.stringify\(out\)\.slice\(/);
  });
});
