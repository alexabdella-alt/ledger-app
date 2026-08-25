// ─────────────────────────────────────────────────────────────────────────────
// C202 — THE UNIVERSAL DIRECTORY (O88 build surface 2).
//
// A CURATED, GLOBAL, BINARY asset: a vendor is in it with ONE canonical mapping, or
// it is not in it. Spec line 27 draws the line this file must not cross —
//
//     "no fuzzy-match scores, no '76% consulting-ish'"
//
// so there is no score in this module and there must never be one. `matchDirectory`
// returns an entry or null. Nothing in between, and nothing ranked.
//
// ★ WHAT THE DIRECTORY IS FOR, in one sentence: recognising vendors NO COMPANY HAS
// ATTESTED YET, by name, because somebody curated them — as opposed to the alias
// mechanism (O111), which recognises THIS company's vendors because a human here said
// so. Global recognition vs local attestation. Toast belongs in the first; the
// landlord at 1214 Franklin Ave belongs in the second.
//
// A directory hit yields tier UNIVERSAL: it BOOKS to the curated default AND flags,
// batched by vendor, until a human attests — at which point the mapping becomes
// company-attested and the KNOWN clock starts. The directory never makes a vendor
// KNOWN by itself; curation is not attestation.
// ─────────────────────────────────────────────────────────────────────────────

import { normalizeDescriptor } from "./vendorIdentity.js";

// ── WHY TWO MATCH TYPES, AND WHY THE LOOSER ONE IS OPT-IN ────────────────────
// EXACT (after normalisation) is the spec's literal reading and the default.
//
// But EXACT cannot recognise Toast, and Toast is the case that motivated this build.
// Its descriptors are `…TOAST INC MERCHANT FEES JAN` / `…FEB` / `TOAST MERCHANT FEES
// APRIL` — normalising to three different keys, one per month. Listing twelve patterns
// per vendor is not curation, it is data entry with a calendar.
//
// PREFIX is the smallest rule that fixes it while staying BINARY: pattern `toast
// merchant fees` matches `toast merchant fees jan` and does not match anything else.
// It is deterministic, unscored, and either matches or does not.
//
// It is opt-in PER ENTRY, and that is the safety property: a curator must deliberately
// choose the looser rule, and the choice is visible in the row rather than hidden in
// the matcher. A blanket prefix rule would let `lone star restaurant` swallow `Lone
// Star Restaurant Supply` — the merge hazard the narrow-strip design exists to avoid,
// re-entering through the directory.
export const MATCH_TYPE = { EXACT: "exact", PREFIX: "prefix" };

// Prefix matching is TOKEN-BOUNDARY SAFE: `toast` must not match `toaster co`. The
// descriptor either equals the pattern, or begins with the pattern followed by a
// space. No other looseness is permitted here.
function patternMatches(normalizedDescriptor, pattern, matchType) {
  const p = normalizeDescriptor(pattern);
  if (!p || !normalizedDescriptor) return false;
  if (normalizedDescriptor === p) return true;
  return matchType === MATCH_TYPE.PREFIX && normalizedDescriptor.startsWith(p + " ");
}

// The lookup. Returns the matching entry, or null. Entries:
//   { entity_key, canonical_name, match_patterns: [string], match_type, default_account_role }
//
// Deliberately returns the FIRST match and does not rank — because ranking is scoring
// wearing a different hat. Two entries claiming one descriptor is a CURATION DEFECT,
// and `directoryConflicts` below exists to surface it at seed time rather than letting
// insertion order silently decide which vendor a charge belongs to.
export function matchDirectory(descriptor, entries = []) {
  const n = normalizeDescriptor(descriptor);
  if (!n) return null;
  for (const e of entries || []) {
    if (!e || e.active === false || !e.entity_key) continue;
    const type = e.match_type === MATCH_TYPE.PREFIX ? MATCH_TYPE.PREFIX : MATCH_TYPE.EXACT;
    for (const pat of e.match_patterns || []) {
      if (patternMatches(n, pat, type)) return e;
    }
  }
  return null;
}

// Curation hygiene: which descriptors would match MORE THAN ONE entry? Run over the
// seed, and over any addition, before it ships. A directory that can answer "who is
// this?" two ways is worse than one that cannot answer at all — the second parks and
// flags, the first books to whichever row was inserted first.
export function directoryConflicts(entries = []) {
  const conflicts = [];
  const list = (entries || []).filter((e) => e && e.entity_key && e.active !== false);
  for (const probe of list) {
    for (const pat of probe.match_patterns || []) {
      const hits = list.filter((e) =>
        (e.match_patterns || []).some((p) =>
          patternMatches(normalizeDescriptor(pat), p, e.match_type === MATCH_TYPE.PREFIX ? MATCH_TYPE.PREFIX : MATCH_TYPE.EXACT)));
      if (hits.length > 1) {
        conflicts.push({ pattern: pat, claimedBy: hits.map((h) => h.entity_key) });
      }
    }
  }
  return conflicts;
}

// ── THE CURATED SEED ─────────────────────────────────────────────────────────
// Kept in code as well as in migration `066` so it is TESTABLE without a database —
// the migration inserts exactly this list, and a test asserts the two agree. A seed
// that drifts from its migration is the ·3b(f3) two-halves-of-one-contract failure.
//
// SCOPE IS DELIBERATELY NARROW: national vendors whose mapping is genuinely
// uncontroversial. Every entry here is a claim that ANY restaurant booking this vendor
// wants this account, and that claim has to be true for a stranger's books.
export const DIRECTORY_SEED = [
  // ★ EXACT IS THE DEFAULT. Only Toast uses PREFIX, and only because its descriptors
  // carry a MONTH NAME. Two defects in the first draft of this seed — caught by the
  // anti-merge probe below, not by reading it — are why:
  //   • `square inc` as a PREFIX pattern DEGRADES: normalising a pattern strips legal
  //     suffixes, so it became `square` and swallowed `SQUARE DANCE HALL`.
  //   • `sysco` as a PREFIX pattern swallowed `SYSCO FUEL` — a different business line,
  //     and a pair `tests/vendorIdentity.test.js` already asserts must never merge.
  // Both are the Q4 one-way door re-entering through the directory. EXACT by default;
  // PREFIX only where a curator has a reason and the pattern is specific enough to
  // carry it.
  { entity_key: "toast",  canonical_name: "Toast",  default_account_role: "merchant_processing_fees",
    match_type: MATCH_TYPE.PREFIX, match_patterns: ["toast merchant fees", "toast inc merchant fees"] },
  { entity_key: "square", canonical_name: "Square", default_account_role: "merchant_processing_fees",
    match_type: MATCH_TYPE.EXACT,  match_patterns: ["squareup", "square inc"] },
  { entity_key: "stripe", canonical_name: "Stripe", default_account_role: "merchant_processing_fees",
    match_type: MATCH_TYPE.EXACT,  match_patterns: ["stripe", "stripe payments"] },

  { entity_key: "meta ads",   canonical_name: "Meta Ads",   default_account_role: "marketing_advertising",
    match_type: MATCH_TYPE.EXACT, match_patterns: ["facebook ads", "facebk ads", "meta platforms"] },
  { entity_key: "google ads", canonical_name: "Google Ads", default_account_role: "marketing_advertising",
    match_type: MATCH_TYPE.EXACT, match_patterns: ["google ads", "google adwords"] },

  // Broadline distributors. EXACT, and the sub-brand matters: `sysco foods` is COGS
  // and `sysco fuel` is not the same vendor for accounting purposes.
  { entity_key: "sysco",               canonical_name: "Sysco",               default_account_role: "cogs",
    match_type: MATCH_TYPE.EXACT, match_patterns: ["sysco", "sysco foods"] },
  { entity_key: "us foods",            canonical_name: "US Foods",            default_account_role: "cogs",
    match_type: MATCH_TYPE.EXACT, match_patterns: ["us foods", "usfoods"] },
  { entity_key: "restaurant depot",    canonical_name: "Restaurant Depot",    default_account_role: "cogs",
    match_type: MATCH_TYPE.EXACT, match_patterns: ["restaurant depot"] },
  { entity_key: "gordon food service", canonical_name: "Gordon Food Service", default_account_role: "cogs",
    match_type: MATCH_TYPE.EXACT, match_patterns: ["gordon food service"] },

  { entity_key: "amazon web services", canonical_name: "Amazon Web Services", default_account_role: "technology_software",
    match_type: MATCH_TYPE.EXACT, match_patterns: ["amazon web services", "aws"] },
  { entity_key: "google workspace",    canonical_name: "Google Workspace",    default_account_role: "technology_software",
    match_type: MATCH_TYPE.EXACT, match_patterns: ["google workspace", "google gsuite"] },
];

// ── TWO CATEGORIES DELIBERATELY LEFT OUT, each for a stated reason ───────────
//
// UTILITIES. There is essentially no national utility in the US — Austin Municipal
// Utilities serves Austin. A "utilities" directory entry would either be empty or
// wrong, and utilities are exactly the case the PER-COMPANY ALIAS (O111) is for: local
// vendor, stable descriptor, one company. Listed in the spec's seed sketch; excluded
// here with the reason rather than seeded thin to match the sketch.
//
// DELIVERY PLATFORMS (DoorDash, Uber Eats, Grubhub). Their mapping is genuinely
// CONTESTED — commission expense, marketing, or a contra against revenue, depending on
// how the operator treats the sale. The directory's whole premise is that a curated
// default is right for a stranger's books, and for these it is not. A contested
// mapping in a global asset is plausibility scoring with a human's name on it.
export const DIRECTORY_EXCLUSIONS = {
  utilities: "no national utility exists; local vendor → per-company alias (O111)",
  delivery_platforms: "mapping is contested (commission vs marketing vs revenue contra) — no default is right for a stranger",
};
