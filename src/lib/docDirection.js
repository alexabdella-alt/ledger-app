// ─────────────────────────────────────────────────────────────────────────────
// Document DIRECTION from the company's own identity (O75). The same invoice PDF is
// revenue/AR if the company ISSUED it, or expense/AP if the company RECEIVED it — only
// the company's self-identity distinguishes them. These pure helpers anchor
// classification on the company's legal name + aliases/DBA.
// ─────────────────────────────────────────────────────────────────────────────

// Common legal suffixes/filler stripped before matching so "Northwind Studio LLC" and
// "Northwind Studio" (and "Northwind Studio, Inc.") all match the same identity.
const STRIP = /\b(incorporated|inc|llc|l\.?l\.?c|ltd|limited|corporation|corp|company|co|plc|llp|lp|pllc)\b/g;

export function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    // ★ O119 — `+` JOINS A NAME EXACTLY AS `&` DOES, AND WAS THE ONLY ONE HANDLED.
    // Live: the same supplier arrived as "ROMA CHEESE & DAIRY CO" on one August bank line
    // and "ROMA CHEESE + DAIRY CO" on another, so they keyed as two different companies —
    // the second sat unmatched, and the system would have learned that vendor's habits
    // twice instead of once. `&` was already mapped; `+` was not in the punctuation strip
    // either, so it survived as a token of its own.
    //
    // ★ THIS WIDENS A MERGE RULE, WHICH IS THE ONE-WAY DOOR (Q4) — so it is deliberately
    // the NARROWEST form: one character, mapped to the word it already means, exactly as
    // its twin is. It cannot merge two vendors that differ by anything else, and the
    // anti-merge pairs in `vendorIdentity.test.js` are asserted either way.
    .replace(/[&+]/g, " and ")
    .replace(/[.,/#!$%^*;:{}=\-_`~()'"]/g, " ")
    .replace(STRIP, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// The company's own identity names (legal name + aliases/DBA), normalized + deduped.
// `aliases` may be an array or a comma/semicolon/newline-separated string.
export function companyIdentityNames(settings = {}) {
  const aliases = Array.isArray(settings.aliases)
    ? settings.aliases
    : String(settings.aliases || "").split(/[,;\n]/);
  const out = new Set();
  for (const n of [settings.name, ...aliases]) {
    const norm = normalizeName(n);
    if (norm) out.add(norm);
  }
  return [...out];
}

// Does a party name (from a document) match any of the company's identity names?
// Substring either direction tolerates "Northwind" vs "Northwind Studio". Requires a
// non-trivial token so a stray short word can't false-match.
export function matchesIdentity(party, identityNames) {
  const p = normalizeName(party);
  if (!p || p.length < 2) return false;
  return (identityNames || []).some(n => n && n.length >= 2 && (p === n || p.includes(n) || n.includes(p)));
}

// Decide document DIRECTION from issuer vs. recipient, anchored on self-identity:
//   issued BY us (we're the issuer / "bill from")   → revenue / AR
//   addressed TO us (we're the recipient / "bill to")→ expense / AP
//   both or neither match, or no identity configured → ambiguous (hold for review)
export function classifyDocDirection({ issuer, recipient, identityNames } = {}) {
  const ids = identityNames || [];
  if (!ids.length) return { direction: "ambiguous", side: null, reason: "no_company_identity" };
  const weIssued = matchesIdentity(issuer, ids);
  const weReceived = matchesIdentity(recipient, ids);
  if (weIssued && !weReceived) return { direction: "revenue", side: "ar", reason: "issued_by_us" };
  if (weReceived && !weIssued) return { direction: "expense", side: "ap", reason: "addressed_to_us" };
  return { direction: "ambiguous", side: null, reason: weIssued && weReceived ? "both_match" : "no_match" };
}
