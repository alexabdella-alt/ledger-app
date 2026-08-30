import { describe, it, expect } from "vitest";
import { NAME_MATCH, nameMatchCensus, nameMatchKind, substringOnlyPairs } from "../src/lib/nameMatch";
import { normalizeName } from "../src/lib/docDirection";
import { autoMatchBankLines } from "../src/lib/bankMatch";

describe("nameMatchKind is the matcher's own predicate, split so the kind is reportable", () => {
  // ★ THE EQUIVALENCE IS THE WHOLE CLAIM OF THE REFACTOR. If this drifts, the instrumentation
  // has silently become a behaviour change — which is exactly what the roadmap forbade.
  const oldPredicate = (a, b) => a === b || a.includes(b) || b.includes(a);
  const corpus = [
    "sysco", "sysco fuel", "lone star", "lone star restaurant supply", "roma cheese and dairy",
    "bluebonnet linen", "bluebonnet linen service", "toast", "toast pos", "hill country milling",
    "franklin ave properties", "gusto", "au", "", "a",
  ];

  it("★ agrees with the old inline expression on every ordered pair", () => {
    for (const a of corpus) for (const b of corpus) {
      if (!a || !b) continue;
      expect(nameMatchKind(a, b) !== NAME_MATCH.NONE).toBe(oldPredicate(a, b));
    }
  });

  it("distinguishes the two kinds", () => {
    expect(nameMatchKind("sysco", "sysco")).toBe(NAME_MATCH.EXACT);
    expect(nameMatchKind("sysco", "sysco fuel")).toBe(NAME_MATCH.SUBSTRING);
    expect(nameMatchKind("sysco", "roma cheese")).toBe(NAME_MATCH.NONE);
    expect(nameMatchKind("", "sysco")).toBe(NAME_MATCH.NONE);
    expect(nameMatchKind(null, undefined)).toBe(NAME_MATCH.NONE);
  });

  it("is symmetric — the rail matches in either direction", () => {
    expect(nameMatchKind("sysco fuel", "sysco")).toBe(NAME_MATCH.SUBSTRING);
  });
});

describe("the census — which vendors the loose rule would merge and the strict one would not", () => {
  it("★ names the pairs vendorIdentity.test.js already asserts must NEVER merge", () => {
    const pairs = substringOnlyPairs(
      ["SYSCO", "SYSCO FUEL", "Lone Star", "Lone Star Restaurant Supply", "Roma Cheese & Dairy Co."],
      normalizeName,
    );
    const keys = pairs.map((p) => `${p.normalizedA}|${p.normalizedB}`);
    expect(keys).toContain("sysco|sysco fuel");
    expect(keys.some((k) => k.includes("lone star") && k.includes("restaurant supply"))).toBe(true);
    // Roma relates to nothing here — the census must not manufacture risk.
    expect(keys.some((k) => k.includes("roma"))).toBe(false);
  });

  it("a book with no colliding names reports an empty census", () => {
    expect(substringOnlyPairs(["Roma Cheese", "Hill Country Milling", "Gusto"], normalizeName)).toEqual([]);
  });

  it("identical names are not a pair — they are one vendor", () => {
    expect(substringOnlyPairs(["Sysco", "SYSCO", "sysco"], normalizeName)).toEqual([]);
  });

  it("counts what a drive actually used", () => {
    expect(nameMatchCensus([
      { name_match: "exact" }, { name_match: "exact" }, { name_match: "substring" }, { name_match: undefined },
    ])).toEqual({ exact: 2, substring: 1, unrecorded: 1 });
  });
});

describe("the matcher records the kind, and still matches exactly what it used to", () => {
  const openItems = [
    { id: "i1", vendor: "Sysco Foods", amount: 500, gl_code: "2000", type: "expense", category: "Expenses" },
  ];
  const run = (vendor) => autoMatchBankLines(
    [{ id: "b1", vendor, amount: -500, type: "expense", date: "2026-08-04" }],
    openItems, { apCode: "2000", arCode: "1200" },
  );

  it("★ an exact-name match is labelled exact", () => {
    const m = run("Sysco Foods");
    expect(m.length).toBe(1);
    expect(m[0].name_match).toBe(NAME_MATCH.EXACT);
  });

  it("★★ a match that ONLY the loose rule permits is labelled substring — this is the number the decision needs", () => {
    const m = run("Sysco");                       // "sysco" ⊂ "sysco foods"
    expect(m.length).toBe(1);
    expect(m[0].name_match).toBe(NAME_MATCH.SUBSTRING);
  });

  it("and an unrelated name still matches nothing, amount notwithstanding", () => {
    expect(run("Roma Cheese").length).toBe(0);
  });

  it("★ THE AMOUNT GATE IS WHY THE LOOSE RULE HAS NOT BITTEN: a wrong-amount line does not match however well the names agree", () => {
    const m = autoMatchBankLines(
      [{ id: "b2", vendor: "Sysco", amount: -501, type: "expense", date: "2026-08-04" }],
      openItems, { apCode: "2000", arCode: "1200" },
    );
    expect(m.length).toBe(0);
  });
});
