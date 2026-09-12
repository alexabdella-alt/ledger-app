import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ── A FUNCTION WITH NO CALLER IS INDISTINGUISHABLE FROM ONE WITH NOTHING TO DO ──
// O137 (C329): the extraction cache's `priorExtraction` and `storeExtraction` were defined
// in App.jsx, pinned by tests that read their BODIES, and called by nothing — for twelve
// days. C331 then found `cashFromBanks` exposed on the context and read by no component,
// computing the one figure §12 says must never be shown as cash. Both are the C195(7)
// shape: mechanism present, trigger absent, and a green suite that cannot tell.
//
// So this asks, of every arrow-declared const inside App.jsx: is it REFERENCED anywhere
// other than its own declaration and the context export line? A name whose only other
// home is `erpCtx` is exposed and unread — the O95 "name the reader" defect in the shape
// of a function.
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
const APP = strip(fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8"));

function walk(dir) {
  return fs.readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return fs.statSync(p).isDirectory() ? walk(p) : /\.(js|jsx)$/.test(f) ? [p] : [];
  });
}
const OTHERS = walk(path.join(process.cwd(), "src"))
  .filter((p) => !p.endsWith(path.join("src", "App.jsx")))
  .map((p) => strip(fs.readFileSync(p, "utf8"))).join("\n");

const ctxStart = APP.indexOf("const erpCtx = {");
const ctxEnd = APP.indexOf("};", ctxStart);
const CTX = APP.slice(ctxStart, ctxEnd);
const APP_SANS_CTX = APP.slice(0, ctxStart) + APP.slice(ctxEnd);

const declared = [...new Set([...APP.matchAll(/^\s+const ([A-Za-z_]\w*) = (?:async )?\(?[^=\n]*\)?\s*=>/gm)].map((m) => m[1]))];
const refs = (name, text) => (text.match(new RegExp(`\\b${name}\\b`, "g")) || []).length;

function unread(app = APP_SANS_CTX, others = OTHERS, names = declared) {
  return names.filter((n) => refs(n, app) <= 1 && refs(n, others) === 0);
}

describe("every function declared in ERP has a reader", () => {
  it("scans a real population", () => {
    expect(ctxStart).toBeGreaterThan(0);
    expect(declared.length).toBeGreaterThan(200);
  });
  it("★★ no declaration is referenced only by itself and the context export", () => {
    expect(unread()).toEqual([]);
  });
  it("★ the check can fail — a planted unread helper is caught", () => {
    const planted = APP_SANS_CTX + "\n  const plantedHelper = async (x) => x;\n";
    expect(unread(planted, OTHERS, [...declared, "plantedHelper"])).toEqual(["plantedHelper"]);
    // …and exposing it on the context is NOT a reader.
    expect(unread(planted, OTHERS + " ", [...declared, "plantedHelper"])).toEqual(["plantedHelper"]);
  });
});
