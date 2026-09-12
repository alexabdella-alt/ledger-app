import { describe, it, expect } from "vitest";
import fs from "node:fs";

// C312 named three router branches that were `setView("books")` SIDE EFFECTS CALLED DURING
// RENDER — a state write inside JSX, reached by no `setView` call site anywhere, kept alive
// by an alias map that had already routed the same words elsewhere. C335 deleted them,
// with the `invoices` screen no seat could reach and the `OnboardView` file nothing
// imported. This keeps the shape from coming back: a `{view === "x" && …}` branch renders
// a component, never calls `setView`.
const APP = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("C335 — router branches render, they do not redirect", () => {
  it("no view branch calls setView during render", () => {
    const bad = [...APP.matchAll(/\{view\s*===\s*"([^"]+)"\s*&&\s*\(\(\)\s*=>\s*\{\s*setView\(/g)].map((m) => m[1]);
    expect(bad).toEqual([]);
  });
  it("the removed ids are gone from the router, and the AI still knows the words", () => {
    for (const id of ["ledger", "money-in", "money-out", "invoices"]) {
      expect(APP).not.toMatch(new RegExp(`\\{view\\s*===\\s*"${id}"`));
    }
    // the navigate alias map is what makes "take me to the ledger" still land somewhere
    expect(APP).toMatch(/ledger:"books", invoices:"books"/);
    expect(APP).toMatch(/"money-in":"books"/);
    expect(APP).toMatch(/"money-out":"books"/);
  });
  it("every view component in src/components/views is imported by something", () => {
    const dir = new URL("../src/components/views/", import.meta.url);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsx")).map((f) => f.replace(/\.jsx$/, ""));
    const all = fs.readdirSync(new URL("../src/components/", import.meta.url)).filter((f) => f.endsWith(".jsx"))
      .map((f) => fs.readFileSync(new URL(`../src/components/${f}`, import.meta.url), "utf8")).join("\n") + APP
      + fs.readdirSync(dir).map((f) => fs.readFileSync(new URL(`../src/components/views/${f}`, import.meta.url), "utf8")).join("\n");
    const orphans = files.filter((name) => !new RegExp(`import\\s+\\{?\\s*\\w*\\s*\\}?\\s*from\\s+["'][^"']*/${name}["']`).test(all)
      && !new RegExp(`import\\s+${name}\\s+from`).test(all));
    expect(orphans).toEqual([]);   // OnboardView was one, for as long as QBOImportView has owned "onboard"
    expect(files.length).toBeGreaterThan(20);
  });
});

// ── AND THE SAME QUESTION OF EVERY MODULE (C336) ──────────────────────────────
// Three files in `src/components/ui/` — a Button, a Card, a StatCard from the C132
// design-system pass — were imported by nothing for months. A module nobody imports is
// the O137 shape at file scale. The three lib modules with no importer are DELIBERATE
// holds and are named as such, so a fourth cannot join them quietly.
import path from "node:path";
describe("C336 — every module under src/ has an importer, or is a named hold", () => {
  const HELD = {
    "src/lib/accruedLiabilities.js": "§12 event #10's builder — tested, awaiting the month-end accrual flow",
    "src/lib/apBackfill.js": "AP/AR historical backfill planners — a no-op on current data, kept for a real-client conversion",
    "src/lib/vendorBackfill.js": "the O88 backfill — ▶ HOLD under Amendment B; runs only in tests until shadow mode says PROCEED",
  };
  const walk = (d) => fs.readdirSync(d).flatMap((f) => { const p = path.join(d, f); return fs.statSync(p).isDirectory() ? walk(p) : /\.(js|jsx)$/.test(f) ? [p] : []; });
  const root = path.join(process.cwd(), "src");
  const files = walk(root);
  const texts = Object.fromEntries(files.map((f) => [f, fs.readFileSync(f, "utf8")]));
  it("no module is imported by nothing, unless it is on the held list with a reason", () => {
    const orphans = [];
    for (const f of files) {
      const rel = path.relative(process.cwd(), f);
      if (/(^|\/)(main|App)\.jsx$/.test(rel)) continue;
      const name = path.basename(f).replace(/\.jsx?$/, "");
      const pat = new RegExp(`from\\s+["'][^"']*/${name}(\\.jsx?)?["']`);
      const imported = files.some((g) => g !== f && pat.test(texts[g]));
      if (!imported && !HELD[rel]) orphans.push(rel);
    }
    expect(orphans).toEqual([]);
  });
  it("every held module is still genuinely unimported — a stale hold is a licence left open", () => {
    for (const rel of Object.keys(HELD)) {
      const f = path.join(process.cwd(), rel);
      const name = path.basename(f).replace(/\.jsx?$/, "");
      const pat = new RegExp(`from\\s+["'][^"']*/${name}(\\.jsx?)?["']`);
      expect([rel, files.some((g) => g !== f && pat.test(texts[g]))]).toEqual([rel, false]);
    }
  });
});

