import { describe, it, expect } from "vitest";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import fs from "fs";
import path from "path";

const traverse = _traverse.default || _traverse;

// THE guard for the crash class we shipped 3× in a row (setCompanies, setCashBalance, …):
// an identifier referenced but not in scope throws `ReferenceError: X is not defined` on
// load — the build doesn't catch it (runtime) and unit tests don't mount views (no render
// harness, O14). This does real SCOPE ANALYSIS (the same thing ESLint's no-undef does):
// parse every src file, collect program-scope "globals" (identifiers bound nowhere), and
// assert none remain after subtracting genuine JS/browser globals. A stale state setter
// left after a useState removal, or a context value never threaded into scope, shows up here.
const GLOBALS = new Set([
  "Object","Array","String","Number","Boolean","Date","RegExp","Math","JSON","Map","Set","WeakMap","WeakSet","Symbol","Promise","Proxy","Reflect","Error","TypeError","RangeError","Function","BigInt",
  "parseInt","parseFloat","isNaN","isFinite","encodeURIComponent","decodeURIComponent","encodeURI","decodeURI","NaN","Infinity","undefined","globalThis","structuredClone","queueMicrotask",
  "Uint8Array","Int8Array","Uint8ClampedArray","Int16Array","Uint16Array","Int32Array","Uint32Array","Float32Array","Float64Array","BigInt64Array","BigUint64Array","ArrayBuffer","DataView","SharedArrayBuffer",
  "window","document","navigator","location","history","screen","console","localStorage","sessionStorage","fetch","Headers","Request","Response","FormData","Blob","File","FileReader","URL","URLSearchParams",
  "setTimeout","clearTimeout","setInterval","clearInterval","requestAnimationFrame","cancelAnimationFrame","alert","confirm","prompt","atob","btoa","crypto","performance","TextEncoder","TextDecoder","Intl",
  "HTMLElement","Image","Event","CustomEvent","KeyboardEvent","MouseEvent","AbortController","ResizeObserver","IntersectionObserver","MutationObserver","getComputedStyle","DOMParser","XMLHttpRequest","WebSocket","Notification","CSS",
  "process","module","require","exports","__dirname","__filename","arguments","React","JSX",
]);

function srcFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) srcFiles(p, out);
    else if (/\.(jsx?|mjs)$/.test(e.name) && !p.includes(".backup")) out.push(p);
  }
  return out;
}

describe("no undefined identifier references in src/ (real scope analysis ≈ eslint no-undef)", () => {
  const files = srcFiles("src");
  it.each(files)("%s — every referenced identifier is in scope or a global", (file) => {
    const code = fs.readFileSync(file, "utf8");
    const ast = parse(code, { sourceType: "module", plugins: ["jsx"] });
    let programScope = null;
    traverse(ast, { Program(p) { programScope = p.scope; } });
    const unresolved = Object.keys(programScope.globals || {}).filter((n) => !GLOBALS.has(n));
    expect(unresolved, `${file} references undeclared identifiers (would crash on load): ${unresolved.join(", ")}`).toEqual([]);
  });
});
