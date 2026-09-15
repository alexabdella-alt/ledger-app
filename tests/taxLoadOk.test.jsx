import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { renderViewHtml } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import TaxView from "../src/components/views/TaxView.jsx";

// ═════════════════════════════════════════════════════════════════════════════
// C417 — THE TAXES SCREEN SHOWED $0 OF ESTIMATED PAYMENTS OVER A FAILED READ, AND A BLUR
// ON THE INPUT WOULD HAVE SAVED THAT 0 OVER THE REAL FIGURE.
// The read's verdict is recorded; while it is false the figure box carries the notice, the
// input is disabled, and `save` refuses. The device-local mirror stands in only for a
// company with no row yet — never for a read that failed. (SSR runs no effects, so the
// screen's two states are pinned in source and the notice's placement by render.)
// ═════════════════════════════════════════════════════════════════════════════
const src = fs.readFileSync("src/components/views/TaxView.jsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");

describe("C417", () => {
  it("the effect records a failed read, and the local mirror is consulted only when the read ran", () => {
    const i = src.indexOf("let loaded = null; let ok = true;");
    expect(i).toBeGreaterThan(-1);
    const eff = src.slice(i, src.indexOf("return () => { cancelled = true; };", i));
    expect(eff).toMatch(/if \(error\) \{ ok = false;/);
    expect(eff).toMatch(/catch \(e\) \{ ok = false;/);
    expect(eff).toMatch(/if \(!cancelled\) setLoadOk\(ok\);/);
    expect(eff).toMatch(/if \(!loaded && ok\) \{/);
  });
  it("save refuses first while the read failed; the input is disabled; the notice is rendered", () => {
    const i = src.indexOf("const save = async (next) => {");
    expect(src.slice(i, i + 300)).toMatch(/^\s*const save = async \(next\) => \{\s*if \(!loadOk\) \{[^\n]*return; \}/);
    expect(src).toMatch(/<input type="number" disabled=\{!loadOk\}/);
    expect(src).toMatch(/\{!loadOk && <div[^>]*><LoadFailedNotice what="saved tax figures" table="tax_settings" \/><\/div>\}/);
  });
  it("renders in both seats without the notice by default (loadOk starts true)", () => {
    const html = renderViewHtml(TaxView, { ...POPULATED });
    expect(html).not.toContain("data-load-failed");
    expect(html).toMatch(/Estimated payments already made this year/);
  });
});
