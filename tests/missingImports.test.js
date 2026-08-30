import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

// ─────────────────────────────────────────────────────────────────────────────
// ★★ A NAME A COMPONENT USES BUT NEVER IMPORTS IS A RUNTIME CRASH THE BUILD CANNOT SEE.
//
// Vite does not resolve free identifiers, so `monthLabel(...)` in a view with no import for
// it builds perfectly and throws the moment that branch renders. This project has no linter,
// and `viewsRender.test.jsx` — which exists for exactly this class — MISSED one: the guilty
// call sat inside a branch that only renders when data exists, and the render fixture has
// none. **That is the render sweep's recorded limitation, met in the wild within a day.**
//
// ★ SCOPED TO NAMES `src/lib` ACTUALLY EXPORTS, deliberately. A general undefined-identifier
// check is a linter and would drown in false positives; this asks one narrow question with
// almost no room for one — *does this file call something a lib exports, without importing
// it?* — which is precisely the mistake being made.
// ─────────────────────────────────────────────────────────────────────────────

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const libExports = new Map();   // name → the module that exports it
for (const f of walk("src/lib").filter((f) => f.endsWith(".js"))) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) libExports.set(m[1], f);
  for (const m of src.matchAll(/^export\s+(?:const|let)\s+([A-Za-z_$][\w$]*)/gm)) libExports.set(m[1], f);
}

const files = walk("src/components").filter((f) => /\.jsx?$/.test(f));

describe("no component calls a lib export it never imported", () => {
  it("★ every lib name a component invokes is in scope in that file", () => {
    expect(libExports.size).toBeGreaterThan(100);   // the roster is real, not an empty scan
    expect(files.length).toBeGreaterThan(20);

    const problems = [];
    for (const file of files) {
      // ★★ STRIP COMMENTS **AND STRING LITERALS** BEFORE SCANNING. Source guards in this
      // codebase have now tripped on their own prose six times, and the first version of
      // THIS one made it six and seven: it flagged `badge (only when signed off)` inside a
      // JSX comment and `"your credit card (liability 2200)"` inside a string. **Prose lives
      // in both places**, so line-prefix stripping was never going to be enough.
      const src = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")          // block comments, JSX ones included
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1")         // line comments (not a :// in a URL)
        .replace(/`(?:\\.|[^`\\])*`/g, '""')          // template literals
        .replace(/'(?:\\.|[^'\\\n])*'/g, '""')        // single-quoted
        .replace(/"(?:\\.|[^"\\\n])*"/g, '""');       // double-quoted

      const inScope = new Set();
      for (const m of src.matchAll(/import\s*\{([^}]*)\}/g)) {
        for (const part of m[1].split(",")) {
          const name = part.trim().split(/\s+as\s+/).pop().trim();
          if (name) inScope.add(name);
        }
      }
      for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) inScope.add(m[1]);
      // Locally declared, including destructured from useERP() or from props.
      for (const m of src.matchAll(/(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) inScope.add(m[1]);
      for (const m of src.matchAll(/(?:const|let)\s*\{([^}]*)\}\s*=/g)) {
        for (const part of m[1].split(",")) {
          const name = part.trim().split(/[:=]/)[0].trim();
          if (name) inScope.add(name);
        }
      }
      for (const m of src.matchAll(/function\s+\w*\s*\(\s*\{([^}]*)\}/g)) {
        for (const part of m[1].split(",")) {
          const name = part.trim().split(/[:=]/)[0].trim();
          if (name) inScope.add(name);
        }
      }

      // ★ NOT PRECEDED BY A DOT. `rows.push(...)` is a METHOD on an array, not a free
      // identifier, and `push` happens to also be a lib export — the first version of this
      // guard reported seven of those and nothing real. A guard that cries wolf is one
      // nobody reads.
      for (const m of src.matchAll(/(?<![.\w$?])([A-Za-z_$][\w$]*)\s*\(/g)) {
        const name = m[1];
        if (!libExports.has(name) || inScope.has(name)) continue;
        problems.push(`${file}: calls ${name}() (exported by ${libExports.get(name)}) without importing it`);
      }
    }
    expect(problems).toEqual([]);
  });
});
