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
