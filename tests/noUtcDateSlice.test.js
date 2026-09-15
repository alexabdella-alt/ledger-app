import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
// C439 — no calendar date is derived from `toISOString().slice(0,10)` anywhere in src/ (C290's
// rule: a Date built from local components reads back as the previous day in UTC from any zone
// ahead of it). One remained, in Reconcile's CSV date fallback.
const walk = (d) => fs.readdirSync(d).flatMap((f) => { const p = path.join(d, f); return fs.statSync(p).isDirectory() ? walk(p) : /\.jsx?$/.test(f) ? [p] : []; });
describe("C439", () => {
  it("src/ carries no UTC date slice", () => {
    const bad = [];
    for (const f of walk("src")) {
      const src = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
      if (/toISOString\(\)\.(slice\(0,\s*10\)|split\("T"\)\[0\]|substring\(0,\s*10\))/.test(src)) bad.push(f);
    }
    expect(bad).toEqual([]);
  });
});
