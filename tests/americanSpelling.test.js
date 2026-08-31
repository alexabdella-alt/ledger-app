import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

// ─────────────────────────────────────────────────────────────────────────────
// ★ THE PRODUCT IS AMERICAN. The operator and the clients are in the US, and a screen that
// says "categorisation" reads as written by someone else — a small thing that costs
// credibility in an accounting product, where looking unfamiliar with the conventions is
// exactly what you cannot afford.
//
// Scoped to what a USER SEES: string literals and JSX text. Code comments are internal and
// deliberately not policed — the rule is about the product, not about how anyone writes.
// ─────────────────────────────────────────────────────────────────────────────

// Whole words only. "analysis", "fulfillment" and "basis" are correct American spellings that
// a naive substring pattern flags — the first version of this guard reported all three.
const BRITISH = [
  /\bcategoris\w*/i, /\brecognis\w*/i, /\bnormalis\w*/i, /\borganis\w*/i, /\bsummaris\w*/i,
  /\bprioritis\w*/i, /\bcustomis\w*/i, /\bauthoris\w*/i, /\butilis\w*/i, /\bapologis\w*/i,
  /\bbehaviour\w*/i, /\bcolour\w*/i, /\bfavour\w*/i, /\bhonour\w*/i, /\blicence\b/i,
  /\bdefence\b/i, /\bcheque\w*/i, /\bcancelled\b/i, /\btravelling\b/i, /\blabelled\b/i,
  /\benrolment\b/i, /\bfulfilment\b/i, /\bjudgement\b/i, /\bcapitalis\w*/i, /\bpractise\b/i,
];

const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

// What a user can read: quoted strings and the text between JSX tags.
function userFacingText(src) {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, " ")          // block comments (JSX comments included)
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");      // line comments, not a :// in a URL
  const out = [];
  for (const m of code.matchAll(/"([^"\\\n]{3,})"|'([^'\\\n]{3,})'|`([^`\\]{3,})`/g)) {
    out.push(m[1] || m[2] || m[3]);
  }
  // JSX text nodes: >…< containing a space (so it is prose, not markup)
  for (const m of code.matchAll(/>([^<>{}\n]*\s[^<>{}\n]*)</g)) out.push(m[1]);
  return out;
}

describe("★ user-facing copy is American English", () => {
  const files = walk("src").filter((f) => /\.(js|jsx)$/.test(f));

  it("no British spelling reaches a screen", () => {
    expect(files.length).toBeGreaterThan(40);
    const problems = [];
    for (const f of files) {
      for (const text of userFacingText(readFileSync(f, "utf8"))) {
        for (const re of BRITISH) {
          const hit = text.match(re);
          if (hit) problems.push(`${f}: "${hit[0]}" in — ${text.trim().slice(0, 70)}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("★ and the guard does not flag correct American words that merely contain those letters", () => {
    // "analysis", "fulfillment" and "basis" all tripped the first version of this pattern.
    const ok = ['"Generate Analysis"', '"Shipping & Fulfillment"', '"on a cash basis"', '"the color of money"'];
    for (const line of ok) {
      for (const text of userFacingText(line)) {
        for (const re of BRITISH) expect(text.match(re)).toBe(null);
      }
    }
  });

  it("★★ and it actually catches one — a guard that finds nothing may simply be broken", () => {
    const sample = userFacingText('const x = "Check how the new categorisation would have done";');
    expect(sample.some((t) => BRITISH.some((re) => re.test(t)))).toBe(true);
  });
});
