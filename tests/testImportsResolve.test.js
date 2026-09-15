import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ═════════════════════════════════════════════════════════════════════════════
// EVERY NAMED IMPORT IN A TEST FILE MUST BE AN EXPORT OF THE MODULE IT NAMES.
//
// Two render tests imported `POPULATED` from `./helpers/renderView.jsx`, which does not
// export it; under the test transform the binding was silently `undefined`, `{ ...undefined }`
// is a no-op, and the tests rendered an EMPTY context while claiming a populated one. They
// stayed green because their assertions happened not to need rows — which is the worst way
// for a fixture to be missing. The build catches this in `src/`; nothing built the tests.
// ═════════════════════════════════════════════════════════════════════════════
const walk = (d) => fs.readdirSync(d).flatMap((f) => { const p = path.join(d, f); return fs.statSync(p).isDirectory() ? walk(p) : /\.(test\.)?jsx?$/.test(f) ? [p] : []; });
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");

function namedExportsOf(file) {
  const src = strip(fs.readFileSync(file, "utf8"));
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) for (const part of m[1].split(",")) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) names.add(n); }
  return names;
}

describe("test files import only names their modules export", () => {
  it("every relative named import resolves", () => {
    const bad = []; let seen = 0;
    for (const f of walk("tests")) {
      const src = strip(fs.readFileSync(f, "utf8"));
      for (const m of src.matchAll(/^import\s*\{([^}]*)\}\s*from\s*["'](\.[^"']+)["']/gm)) {   // line-start only: a quoted import inside a test's own assertion is not an import
        let target = path.resolve(path.dirname(f), m[2]);
        if (!fs.existsSync(target)) target = [".js", ".jsx", "/index.js"].map((e) => target + e).find((p) => fs.existsSync(p)) || target;   // extensionless imports
        if (!fs.existsSync(target)) { bad.push(`${f}: ${m[2]} does not exist`); continue; }
        const exports = namedExportsOf(target);
        for (const part of m[1].split(",")) {
          const n = part.trim().split(/\s+as\s+/)[0].trim();
          if (!n) continue;
          seen++;
          if (!exports.has(n)) bad.push(`${f}: '${n}' is not exported by ${m[2]}`);
        }
      }
    }
    expect(seen).toBeGreaterThan(500);
    expect(bad).toEqual([]);
  });
});
