import { describe, it, expect } from "vitest";
import { extractFirstJson } from "../src/lib/aiJson.js";

// ════════════════════════════════════════════════════════════════════════════
// C188 — robust JSON extraction. Never throws; returns the first balanced JSON
// value or null. The live bug: a valid JSON object followed by trailing prose.
// ════════════════════════════════════════════════════════════════════════════

describe("extractFirstJson", () => {
  it("clean JSON object", () => {
    expect(extractFirstJson('{"total_gross":1000,"source":"Gusto"}')).toEqual({ total_gross: 1000, source: "Gusto" });
  });

  it("fenced JSON (```json … ```)", () => {
    expect(extractFirstJson('```json\n{"a":1,"b":[2,3]}\n```')).toEqual({ a: 1, b: [2, 3] });
    expect(extractFirstJson('```\n{"a":1}\n```')).toEqual({ a: 1 });   // bare fence
  });

  it("JSON + trailing prose — THE LIVE BUG (payroll parse died on this)", () => {
    const text = '{"total_gross":5000,"total_net":3800}\n\nNote: this is an estimate; verify against the register.';
    expect(extractFirstJson(text)).toEqual({ total_gross: 5000, total_net: 3800 });
  });

  it("leading prose + JSON", () => {
    expect(extractFirstJson('Here is the parsed payroll data:\n{"total_gross":1200}')).toEqual({ total_gross: 1200 });
  });

  it("leading prose that itself contains a stray bracket, then the real JSON", () => {
    // "[see below]" is not valid JSON → skipped in favor of the real object that follows.
    expect(extractFirstJson('Options [see below] then:\n{"a":1}')).toEqual({ a: 1 });
  });

  it("nested braces INSIDE strings, with escaped quotes", () => {
    const text = '{"note":"he said \\"{done}\\" ok","items":[{"x":1}],"n":2}';
    expect(extractFirstJson(text)).toEqual({ note: 'he said "{done}" ok', items: [{ x: 1 }], n: 2 });
  });

  it("array root", () => {
    expect(extractFirstJson('[{"a":1},{"b":2}]')).toEqual([{ a: 1 }, { b: 2 }]);
    expect(extractFirstJson('```json\n[1,2,3]\n``` trailing')).toEqual([1, 2, 3]);
  });

  it("null on garbage (no JSON at all)", () => {
    expect(extractFirstJson("no json here, sorry")).toBe(null);
    expect(extractFirstJson("")).toBe(null);
    expect(extractFirstJson(null)).toBe(null);
    expect(extractFirstJson(undefined)).toBe(null);
  });

  it("null on truncated / unbalanced JSON", () => {
    expect(extractFirstJson('{"a": 1, "b":')).toBe(null);          // cut off mid-object
    expect(extractFirstJson('{"a": [1, 2, 3')).toBe(null);          // unclosed array + object
    expect(extractFirstJson('{"a": "unterminated string')).toBe(null);
  });

  it("picks the FIRST balanced object when several are concatenated", () => {
    expect(extractFirstJson('{"first":1}{"second":2}')).toEqual({ first: 1 });
  });
});
