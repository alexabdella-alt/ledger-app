// ─────────────────────────────────────────────────────────────────────────────
// THE SAME SUPPLIER UNDER A NEW NAME — SUGGEST IT, NEVER DECIDE IT.
//
// `O111` gave a person a way to say "these two names are one supplier". It still requires
// them to NOTICE, which on a real book means reading a vendor list and spotting that
// `FRANKLIN AVE PROPERTIES LP RENT` and `Franklin Ave Properties` are one landlord.
//
// ★★★ AND THE HARD CONSTRAINT IS THE WHOLE DESIGN: A SUGGESTER THAT PROPOSES A KNOWN-WRONG
// MERGE IS WORSE THAN NO SUGGESTER, because people stop reading it and then accept a bad one
// out of habit. `SYSCO` and `SYSCO FUEL` are a real pair of distinct businesses that
// `vendorIdentity.test.js` already forbids merging — **so they must not be suggested either.**
// A merge is a one-way door: it launders one vendor's attested mapping onto another's charges,
// silently.
//
// ★★ SO THE DISCRIMINATOR IS *WHAT THE EXTRA WORDS ARE*, NOT HOW SIMILAR THE STRINGS LOOK.
//   · `Franklin Ave Properties` vs `…LP RENT` — the extra words are a LEGAL FORM and a
//     PURPOSE word. Neither changes who the business is. **Suggest.**
//   · `SYSCO` vs `SYSCO FUEL` — the extra word is a novel noun that says what the business
//     sells. **Do not suggest.**
// A similarity score cannot tell those apart; they are about equally similar. The vocabulary
// of "words that do not change identity" is small, explicit, and pinned by a test asserting
// its exact contents — **widening it silently is how the anti-merge cases start being
// suggested.**
//
// ★ AND IT ONLY EVER SUGGESTS. Nothing here writes, nothing here decides an account. A
// suggestion becomes real when a person confirms it, through the existing alias path.
//
// Pure.
// ─────────────────────────────────────────────────────────────────────────────

import { normalizeName } from "./docDirection.js";

// Words that describe the LEGAL FORM of a business. Present or absent, it is the same company.
//
// ★ MOSTLY BELT-AND-BRACES, AND WORTH SAYING SO RATHER THAN LETTING IT LOOK LOAD-BEARING:
// `normalizeName` ALREADY strips the common forms, so "Alamo Ice LLC" and "Alamo Ice" reach
// the same key and never become a suggestion — they are one vendor before this module sees
// them. What is left here is the forms that strip does not carry (`pc`, `sa`, `gmbh`, `bv`,
// `nv`) plus a guard against the strip list narrowing later.
export const LEGAL_FORM_WORDS = new Set([
  "llc", "inc", "incorporated", "corp", "corporation", "co", "company",
  "lp", "llp", "ltd", "limited", "plc", "pllc", "pc", "sa", "gmbh", "bv", "nv",
]);

// Words a payment RAIL or a memo adds to say what the payment was FOR. They describe the
// transaction, not the counterparty.
//
// ★ DELIBERATELY SHORT. Every word added here is a word that stops distinguishing two
// businesses, so each one is a small widening of a one-way door. "supply", "services",
// "foods", "fuel" are NOT here and must not be: they are what a business sells.
export const PURPOSE_WORDS = new Set([
  "rent", "payment", "pymt", "invoice", "inv", "bill", "billing", "autopay", "auto",
  "ach", "eft", "debit", "credit", "card", "purchase", "pos", "recurring", "monthly",
  "deposit", "transfer", "xfer", "online", "web", "chk", "check",
]);

const tokens = (s) => normalizeName(s).split(" ").filter(Boolean);

export const SUGGEST_REASON = {
  EXTRA_WORDS_ONLY: "extra_words_only",   // one name is the other plus legal/purpose words
  LIKELY_TYPO: "likely_typo",             // near-identical spelling
};

// Levenshtein, bounded — we only ever care about "within 1", so bail out early.
function within1(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// Is `long` just `short` with words added that never change who a business is?
function extraWordsOnly(shortToks, longToks) {
  if (!shortToks.length || longToks.length <= shortToks.length) return false;
  // The short name's words must appear, in order, at the start — a supplier's name does not
  // get REORDERED by a payment rail, and allowing arbitrary order would merge "Star Lone"
  // with "Lone Star".
  for (let i = 0; i < shortToks.length; i++) if (longToks[i] !== shortToks[i]) return false;
  const extra = longToks.slice(shortToks.length);
  // ★ EVERY extra word must be known-harmless. One novel noun and we say nothing — the
  // conservative direction, because a missed suggestion costs a person one manual alias while
  // a wrong one silently merges two businesses' books.
  return extra.every((w) => LEGAL_FORM_WORDS.has(w) || PURPOSE_WORDS.has(w));
}

/**
 * Candidate pairs of names that are probably one supplier.
 *
 * `names`   — the distinct vendor names seen in the books.
 * `asserted` — pairs a person has already ruled on, in either direction, as
 *              `["a::b", …]` of normalised names. Both a CONFIRMED alias and a REJECTED
 *              suggestion belong here: re-proposing something already declined is how a
 *              queue teaches people to ignore it.
 */
export function suggestVendorMerges(names = [], { asserted = [] } = {}) {
  const seen = new Map();                       // normalised → first raw spelling
  for (const raw of names || []) {
    const n = normalizeName(raw);
    if (!n || n.length < 3) continue;
    if (!seen.has(n)) seen.set(n, raw);
  }
  const done = new Set(asserted || []);
  const key = (a, b) => (a < b ? `${a}::${b}` : `${b}::${a}`);
  const entries = [...seen.entries()];
  const out = [];

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [na, rawA] = entries[i];
      const [nb, rawB] = entries[j];
      if (done.has(key(na, nb))) continue;
      const ta = tokens(na), tb = tokens(nb);

      let reason = null;
      if (extraWordsOnly(ta, tb) || extraWordsOnly(tb, ta)) reason = SUGGEST_REASON.EXTRA_WORDS_ONLY;
      // A typo rule is only safe on names long enough that a single character is unlikely to
      // be a real difference. "Ace" and "Ace2" would otherwise pair.
      else if (na.length >= 8 && nb.length >= 8 && within1(na, nb)) reason = SUGGEST_REASON.LIKELY_TYPO;

      if (reason) out.push({ a: rawA, b: rawB, normalizedA: na, normalizedB: nb, reason });
    }
  }
  // Shortest names first: the pair a person can judge at a glance comes before the long ones.
  return out.sort((x, y) => (x.normalizedA + x.normalizedB).length - (y.normalizedA + y.normalizedB).length);
}

// The question a person is actually answering. Names both spellings, because "are these the
// same supplier?" is unanswerable without seeing them.
export function suggestionCopy(pair) {
  if (!pair) return null;
  return pair.reason === SUGGEST_REASON.LIKELY_TYPO
    ? `“${pair.a}” and “${pair.b}” are spelled almost identically. Same supplier?`
    : `“${pair.a}” and “${pair.b}” look like the same supplier under a longer name. Same supplier?`;
}
