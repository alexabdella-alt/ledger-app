import { describe, it, expect } from "vitest";
import fs from "node:fs";
// ═════════════════════════════════════════════════════════════════════════════
// C463 — EVERY `useMemo` IN App.jsx LISTS THE STATE IT READS. No linter is configured, so
// `react-hooks/exhaustive-deps` never ran here; C347 found `vendorSummary` missing
// `aliasIndex` (a confirmed alias did not regroup the Vendors tab), and `ownerTrust` read
// `hasAttester` and `signoffs` with neither in its deps — right only because the effect that
// sets them batches with a dep that is listed. A stale memo on an accounting screen is a
// silently wrong number, which is the failure C297 refused to risk.
// ═════════════════════════════════════════════════════════════════════════════
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
describe("useMemo deps in App.jsx", () => {
  it("every memo body's state reads are in its deps", () => {
    const s = strip(fs.readFileSync("src/App.jsx", "utf8"));
    const states = new Set([...s.matchAll(/const \[(\w+), set\w+\] = useState/g)].map((m) => m[1]));
    const names = new Set([...states, "currentCompany", "session", "companies", "userRole"]);
    const bad = [];
    const check = (line, body, depsStr) => {
      const deps = new Set(depsStr.split(",").map((x) => x.trim().split("?.")[0].split(".")[0]).filter(Boolean));
      const used = new Set([...body.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)].map((m) => m[1]));
      const missing = [...used].filter((n) => names.has(n) && !deps.has(n));
      if (missing.length) bad.push(`line ${line}: ${missing.join(", ")}`);
    };
    for (const m of s.matchAll(/useMemo\(\(\) => \{/g)) {
      let k = m.index + m[0].length, depth = 1, p = k;
      while (depth && p < s.length) { depth += (s[p] === "{") - (s[p] === "}"); p++; }
      const dm = /^\s*,\s*\[([^\]]*)\]/.exec(s.slice(p, p + 600));
      if (dm) check(s.slice(0, m.index).split("\n").length, s.slice(k, p), dm[1]);
    }
    for (const m of s.matchAll(/useMemo\(\(\) => (?!\{)(.*?), \[([^\]]*)\]\)/g)) check(s.slice(0, m.index).split("\n").length, m[1], m[2]);
    expect(bad).toEqual([]);
    expect(states.size).toBeGreaterThan(50);
  });
});
