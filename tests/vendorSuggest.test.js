import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import {
  LEGAL_FORM_WORDS, PURPOSE_WORDS, SUGGEST_REASON, suggestVendorMerges, suggestionCopy,
} from "../src/lib/vendorSuggest";

const pairsFor = (names, opts) => suggestVendorMerges(names, opts)
  .map((p) => `${p.normalizedA}|${p.normalizedB}`);

describe("O106 — suggests the same supplier under a new name", () => {
  it("★ the live case: a bank descriptor with a legal form and a purpose word", () => {
    const p = suggestVendorMerges(["Franklin Ave Properties", "FRANKLIN AVE PROPERTIES LP RENT"]);
    expect(p.length).toBe(1);
    expect(p[0].reason).toBe(SUGGEST_REASON.EXTRA_WORDS_ONLY);
  });

  it("★★ a plain legal suffix needs NO suggestion — those already merge, and proposing them would be noise", () => {
    // `normalizeName` strips the common legal forms, so these reach the same key and are one
    // vendor before this module ever sees them. Asserted explicitly because my first version
    // of this test expected a suggestion, which would have meant asking a person to confirm
    // something the system had already decided correctly.
    expect(pairsFor(["Roma Cheese & Dairy", "Roma Cheese & Dairy Co."])).toEqual([]);
    expect(pairsFor(["Alamo Ice", "Alamo Ice LLC"])).toEqual([]);
  });

  it("★ but a legal form the stripper does not carry is still caught", () => {
    expect(pairsFor(["Bergmann Brot", "Bergmann Brot GmbH"]).length).toBe(1);
  });

  it("★ and a typo, on a name long enough that one character is unlikely to be real", () => {
    const p = suggestVendorMerges(["Hill Country Milling", "Hill Country Miling"]);
    expect(p.length).toBe(1);
    expect(p[0].reason).toBe(SUGGEST_REASON.LIKELY_TYPO);
  });
});

describe("★★★ and it must NOT suggest the pairs that are genuinely different businesses", () => {
  // A suggester that proposes a known-wrong merge is worse than none: people stop reading it
  // and then accept a bad one out of habit. These exact pairs are already forbidden from
  // merging in vendorIdentity.test.js.
  it("SYSCO and SYSCO FUEL are not suggested — 'fuel' says what the business sells", () => {
    expect(pairsFor(["SYSCO", "SYSCO FUEL"])).toEqual([]);
  });

  it("Lone Star and Lone Star Restaurant Supply are not suggested", () => {
    expect(pairsFor(["Lone Star", "Lone Star Restaurant Supply"])).toEqual([]);
  });

  it("★ one novel word is enough to stay silent — a missed suggestion costs one manual alias, a wrong one merges two businesses' books", () => {
    expect(pairsFor(["Alamo Ice", "Alamo Ice Cream"])).toEqual([]);
    expect(pairsFor(["Toast POS", "Toast POS Payroll"])).toEqual([]);
  });

  it("★★ word ORDER matters — a rail does not reorder a supplier's name", () => {
    // ★ THE FIRST VERSION OF THIS TEST WAS VACUOUS AND A SURVIVING MUTATION SAID SO.
    // It used "Lone Star" vs "Star Lone LLC", whose normalised token COUNTS are equal — so
    // the "longer name" guard rejected the pair before the order check was ever reached, and
    // replacing that check with an order-blind one changed nothing. The long side must
    // genuinely have MORE tokens for the order rule to be the thing under test.
    expect(pairsFor(["Lone Star", "Star Lone Rent"])).toEqual([]);
    // …and the same words in the right order DO pair, so this is not passing by accident.
    expect(pairsFor(["Lone Star", "Lone Star Rent"]).length).toBe(1);
  });

  it("unrelated vendors produce nothing", () => {
    expect(pairsFor(["Roma Cheese", "Hill Country Milling", "Gusto", "Bluebonnet Linen"])).toEqual([]);
  });

  it("short names are left alone — one character is not a typo signal on 'Ace'", () => {
    expect(pairsFor(["Ace", "Ace2", "Aces"])).toEqual([]);
  });
});

describe("it never re-asks a question already answered", () => {
  it("★ a confirmed alias OR a rejected suggestion suppresses the pair", () => {
    // Re-proposing something already declined is how a queue teaches people to ignore it.
    const names = ["Franklin Ave Properties", "FRANKLIN AVE PROPERTIES LP RENT"];
    expect(suggestVendorMerges(names).length).toBe(1);
    const asserted = ["franklin ave properties::franklin ave properties rent"];
    expect(suggestVendorMerges(names, { asserted }).length).toBe(0);
  });

  it("suppression works whichever way round the pair is given", () => {
    const asserted = ["franklin ave properties::franklin ave properties rent"];
    const flipped = ["FRANKLIN AVE PROPERTIES LP RENT", "Franklin Ave Properties"];
    expect(suggestVendorMerges(flipped, { asserted }).length).toBe(0);
  });
});

describe("the vocabulary is pinned, because widening it silently is the failure mode", () => {
  it("★★ legal-form and purpose words have exact, reviewed contents", () => {
    // Every word here is a word that stops distinguishing two businesses — each addition is a
    // small widening of a one-way door, so the set changing must break a test.
    expect([...LEGAL_FORM_WORDS].sort()).toEqual([
      "bv", "co", "company", "corp", "corporation", "gmbh", "inc", "incorporated",
      "limited", "llc", "llp", "lp", "ltd", "nv", "pc", "plc", "pllc", "sa",
    ]);
    // ★ EXACT CONTENTS, NOT A COUNT. My first version pinned `.size`, which is satisfied by
    // swapping one word for another — and the whole risk here is WHICH words are in the set.
    expect([...PURPOSE_WORDS].sort()).toEqual([
      "ach", "auto", "autopay", "bill", "billing", "card", "check", "chk", "credit",
      "debit", "deposit", "eft", "inv", "invoice", "monthly", "online", "payment", "pos",
      "purchase", "pymt", "recurring", "rent", "transfer", "web", "xfer",
    ]);
  });

  it("★★★ and the words a business SELLS are deliberately absent", () => {
    for (const w of ["supply", "supplies", "services", "foods", "fuel", "cream", "linen", "produce", "meat"]) {
      expect(LEGAL_FORM_WORDS.has(w)).toBe(false);
      expect(PURPOSE_WORDS.has(w)).toBe(false);
    }
  });
});

describe("it suggests and never decides", () => {
  it("★★ the module cannot write, and cannot reach an account", () => {
    const src = readFileSync("src/lib/vendorSuggest.js", "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    for (const forbidden of ["supabase", "insert(", "update(", "checkedRowUpdate", "gl_code", "account_id", "ensureAccount"]) {
      expect(src).not.toContain(forbidden);
    }
    expect(src).toMatch(/^import \{ normalizeName \} from "\.\/docDirection\.js";$/m);
  });

  it("the copy asks a question and shows both spellings", () => {
    const [p] = suggestVendorMerges(["Franklin Ave Properties", "FRANKLIN AVE PROPERTIES LP RENT"]);
    const t = suggestionCopy(p);
    expect(t).toMatch(/Same supplier\?/);
    expect(t).toContain("Franklin Ave Properties");
    expect(t).toContain("FRANKLIN AVE PROPERTIES LP RENT");
    expect(suggestionCopy(null)).toBe(null);
  });
});

describe("★★ the suggester now has a reader, and the merge is gated on the write landing", () => {
  const view = readFileSync("src/components/views/VendorsView.jsx", "utf8");
  const app = readFileSync("src/App.jsx", "utf8");
  const strip = (t) => t
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

  it("★ it reaches a screen — a suggester nobody sees is the field-with-no-reader defect", () => {
    expect(strip(view)).toMatch(/suggestVendorMerges\(names, \{ asserted \}\)/);
    expect(strip(view)).toMatch(/suggestionCopy\(p\)/);
  });

  it("★★★ persistContact REPORTS now — it returned nothing, so any 'saved ✓' was an assumption", () => {
    expect(strip(app)).toMatch(/return \{ ok: !error, error: error \? \(error\.message \|\| String\(error\)\) : null, row: data \|\| null \};/);
  });

  it("★★ and the confirmation is gated on that verdict, not on the click", () => {
    const at = strip(view).indexOf("const r = await persistContact(");
    expect(at).toBeGreaterThan(-1);
    const after = strip(view).slice(at, at + 700);
    expect(after).toMatch(/if \(!r \|\| !r\.ok\)/);
    // A merge that did not save must not be recorded as answered, or the pair vanishes from
    // the list while the two names stay split.
    expect(after.indexOf("dismiss(pair)")).toBeGreaterThan(after.indexOf("if (!r || !r.ok)"));
  });

  it("★ the only write it performs is the alias write the vendor form already does", () => {
    const at = strip(view).indexOf("function VendorMergeSuggestions");
    const block = strip(view).slice(at);
    expect(at).toBeGreaterThan(-1);
    expect(block).not.toMatch(/supabase|\.insert\(|\.update\(|\.delete\(/);
    expect((block.match(/persistContact\(/g) || []).length).toBe(1);
  });

  it("★ and it runs the same validation the form runs — one door for a merge", () => {
    const at = strip(view).indexOf("function VendorMergeSuggestions");
    expect(strip(view).slice(at)).toMatch(/validateAlias\(alias, contact, others\)/);
  });
});
