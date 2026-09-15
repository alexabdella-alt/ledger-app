import { describe, it, expect } from "vitest";
import fs from "node:fs";
// C433 — the manual-entry form books once per click, through the shared money-moves gate.
describe("C433", () => {
  it("doBook runs doBookOnce through moneyMoves.current.run", () => {
    const src = fs.readFileSync("src/App.jsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
    expect(src).toMatch(/const doBook = \(\) => moneyMoves\.current\.run\("manual-entry", doBookOnce\);\s*const doBookOnce = async \(\) => \{/);
    // the gated body still writes first and clears the form after (C362)
    const i = src.indexOf("const doBookOnce = async () => {");
    const body = src.slice(i, i + 3000);
    expect(body.indexOf("const jeId = await bookToDb(invoice);")).toBeLessThan(body.indexOf("setForm({ vendor:\"\""));
  });
});
