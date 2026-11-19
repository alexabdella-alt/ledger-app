// ★ C739 — no customer-facing accountant. Operator, 2026-11-18: "These people will not be hiring
// accountants to use this software. It's either them or me or a combo of both." The Shadow team is
// every client's reviewer: no sentence an owner can read says "your accountant", and nothing offers
// "Invite your accountant". (Legal disclaimers may still say "a qualified tax professional or
// accountant"; the reviewer's own screens and audit text are not owner copy.)
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(jsx?|ts)$/.test(f)) files.push(p); } })("src");
const ALLOWED = new Set(["src/components/views/TeamView.jsx"]);   // step 3 (roles) — tightened when the Accountant role goes
const literals = (src) => {
  const out = [];
  src.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("{/*")) return;
    const code = line.replace(/\/\/.*$/, "");
    for (const m of code.matchAll(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|>([^<>{}]+)</g)) out.push([i + 1, m[0]]);
  });
  return out;
};

describe("no customer-facing accountant", () => {
  it("★ no sentence says 'your accountant' or offers to invite one", () => {
    const bad = [];
    for (const f of files) {
      if (ALLOWED.has(f)) continue;
      for (const [n, lit] of literals(readFileSync(f, "utf8"))) if (/your accountant|invite your accountant|add your accountant/i.test(lit)) bad.push(`${f}:${n} ${lit.slice(0, 90)}`);
    }
    expect(bad).toEqual([]);
  });
  it("★ every client has a reviewer (the Shadow team) — the switch is unconditional", () => {
    expect(readFileSync("src/App.jsx", "utf8")).toContain("void mem; setHasAttester(true);");
  });
  it("the guard can fail: a planted sentence is caught", () => {
    const planted = literals('const x = "Ask your accountant about it";');
    expect(planted.some(([, l]) => /your accountant/i.test(l))).toBe(true);
  });
});
