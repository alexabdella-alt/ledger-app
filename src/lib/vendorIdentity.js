// ─────────────────────────────────────────────────────────────────────────────
// O88 CALIBRATION — BUILD SURFACE 1: IDENTITY RESOLUTION (descriptor → entity).
//
// The spec kills descriptor-legibility confidence as a booking authority and puts
// this in its place. That is a promotion: identity resolution now does the real
// work the legibility score only pretended to do (spec line 82). If this module is
// wrong, the whole ladder is wrong — a KNOWN vendor whose descriptor didn't resolve
// is indistinguishable from a STRANGER, and books to suspense.
//
// THE ONE RULE: this module answers "WHO is this?" and NOTHING else. It never
// returns an account, never returns a score, never decides whether to book. The
// tiering (KNOWN/DECLARED/UNIVERSAL/STRANGER) is build surface 3 and reads the
// entity key this produces. Keeping the two apart is what stops "recognition"
// quietly turning back into "plausibility" — the exact line spec line 27 draws.
//
// MATCHING IS EXACT-AFTER-NORMALIZATION, NEVER FUZZY. There is no similarity
// score anywhere in this file and there must never be one. A descriptor either
// normalizes onto a known key, matches a recorded alias, or hits a curated
// directory pattern — or it is unresolved, which is an honest answer. "76%
// consulting-ish" is precisely what this spec exists to delete.
//
// C200: PURE, and deliberately WIRED TO NOTHING. No caller resolves identity yet.
// ─────────────────────────────────────────────────────────────────────────────

import { normalizeName } from "./docDirection.js";

// How an entity key was arrived at. Ordered by authority — a caller comparing two
// resolutions should prefer the earlier one, and the flag copy names the source so
// a reviewer can see WHY we think this is that vendor.
export const MATCH_SOURCE = {
  ALIAS: "alias",            // this company recorded this exact descriptor for this entity
  NORMALIZED: "normalized",  // the descriptor normalizes onto an entity key we hold
  DIRECTORY: "directory",    // a curated global directory pattern claims it
  UNRESOLVED: "unresolved",  // none of the above — an honest miss, not a guess
};

// ── BANK-DESCRIPTOR NOISE ────────────────────────────────────────────────────
// Card networks and ACH rails wrap the merchant name in transport junk that has
// nothing to do with identity: terminal prefixes, city/state tails, trace numbers,
// dates. `normalizeName` (docDirection.js) handles PARTY-NAME shape — legal
// suffixes, punctuation, case — and was written for invoice parties, not bank
// lines. This strips the rail noise FIRST so the same vendor arriving down three
// rails collapses to one key.
//
// Every pattern here is anchored and narrow ON PURPOSE. A greedy strip is how two
// genuinely different vendors get merged into one entity, and a merged entity
// silently launders one vendor's attested mapping onto another's charges — the
// "phantom vendor accruing unattested history" one-way door of Q4, arrived at from
// the other direction.
const RAIL_PREFIXES = [
  /^sq\s*\*+\s*/i,               // SQ *COFFEE
  /^tst\s*\*+\s*/i,              // TST* (Toast)
  /^pos\s+(purchase|debit)\s+/i,
  /^(pp|paypal)\s*\*+\s*/i,
  /^ach\s+(debit|credit|payment|pmt)\s+/i,
  /^(recurring\s+)?(debit|credit)\s+card\s+(purchase|payment)\s+/i,
  /^checkcard\s+\d*\s*/i,
  /^purchase\s+authorized\s+on\s+\d{1,2}\/\d{1,2}\s+/i,
  /^(visa|mastercard|amex|discover)\s+(purchase|payment)\s+/i,
];

const RAIL_TAILS = [
  /\s+#\d+\s*$/,                                  // store number
  /\s+\d{6,}\s*$/,                                // trace / auth number
  /\s+\d{1,2}\/\d{1,2}(\/\d{2,4})?\s*$/,          // trailing date
  /\s+[a-z]{2}\s*$/i,                             // trailing state code
  /\s+x{2,}\d{3,}\s*$/i,                          // masked card tail
];

// Strip transport noise, then apply the existing party-name normalizer. Returns ""
// when nothing identity-bearing survives — which is a real outcome for a pure-numeric
// descriptor, and must resolve to UNRESOLVED rather than to an empty-string entity.
export function normalizeDescriptor(descriptor) {
  let s = String(descriptor == null ? "" : descriptor).trim();
  if (!s) return "";
  for (const re of RAIL_PREFIXES) s = s.replace(re, "");
  // Tails are applied repeatedly: "SYSCO FOODS #4417 TX" carries two of them.
  let before;
  do {
    before = s;
    for (const re of RAIL_TAILS) s = s.replace(re, "");
    s = s.trim();
  } while (s !== before);
  const n = normalizeName(s) || "";
  // A descriptor with NO LETTERS carries no vendor identity — it is a trace number,
  // an auth code, a bare store number. Letting it through would mint an entity keyed
  // on "884213", and that phantom would then accrue attested history like a real
  // vendor: Q4's one-way door, opened by a rounding error. Found by the test, not by
  // reading the code — the tails only strip when preceded by whitespace, so a BARE
  // numeric survived every strip and normalized to itself.
  return /[a-z]/.test(n) ? n : "";
}

// The stable per-company identity of a vendor. Derived from the normalized
// descriptor, NOT from a display name, so renaming a contact never re-keys the
// entity (the ·3b f3 lesson: key on content, not on a label that moves).
export function entityKeyFor(descriptor) {
  const n = normalizeDescriptor(descriptor);
  return n || null;
}

// ── RESOLUTION ───────────────────────────────────────────────────────────────
// `aliases`   : [{ entityKey, descriptor }] — descriptors THIS company has attested
//               onto an entity. Highest authority: a human said so.
// `knownKeys` : iterable of entity keys this company already holds (vendor_state,
//               build surface 3). Presence means "we have seen this before"; it says
//               nothing about tier, which is not this module's business.
// `directory` : [{ entityKey, patterns: [string] }] — curated global directory
//               (build surface 2). BINARY: a pattern matches the normalized
//               descriptor exactly, or it does not. No scoring.
//
// Returns { entityKey, matchedVia, rawDescriptor, normalized } — and `entityKey` is
// null exactly when matchedVia is UNRESOLVED. Never throws.
export function resolveVendorIdentity(descriptor, { aliases = [], knownKeys = [], directory = [] } = {}) {
  const raw = String(descriptor == null ? "" : descriptor);
  const normalized = normalizeDescriptor(raw);
  const miss = { entityKey: null, matchedVia: MATCH_SOURCE.UNRESOLVED, rawDescriptor: raw, normalized };
  if (!normalized) return miss;

  // 1. ALIAS — an attested descriptor→entity link. Compared on the NORMALIZED form
  //    of both sides, so an alias recorded from one rail still catches another.
  for (const a of aliases || []) {
    if (!a || !a.entityKey) continue;
    if (normalizeDescriptor(a.descriptor) === normalized) {
      return { entityKey: String(a.entityKey), matchedVia: MATCH_SOURCE.ALIAS, rawDescriptor: raw, normalized };
    }
  }

  // 2. NORMALIZED — the descriptor lands on a key we already hold.
  for (const k of knownKeys || []) {
    if (k != null && String(k) === normalized) {
      return { entityKey: normalized, matchedVia: MATCH_SOURCE.NORMALIZED, rawDescriptor: raw, normalized };
    }
  }

  // 3. DIRECTORY — curated, binary, global.
  for (const d of directory || []) {
    if (!d || !d.entityKey) continue;
    for (const pat of d.patterns || []) {
      if (normalizeDescriptor(pat) === normalized) {
        return { entityKey: String(d.entityKey), matchedVia: MATCH_SOURCE.DIRECTORY, rawDescriptor: raw, normalized };
      }
    }
  }

  return miss;
}

// Do these descriptors name the same vendor? The property the Lone Star corpus
// exists to hold: four rails, one entity. Convenience over resolveVendorIdentity
// for tests and for the census pass's grouping.
export function sameEntity(a, b) {
  const ka = entityKeyFor(a), kb = entityKeyFor(b);
  return !!ka && ka === kb;
}

// Group raw descriptors by resolved entity — the shape the onboarding census (build
// surface 5) reads to say "these 6 lines are one vendor, confirm the mapping once".
// Unresolved descriptors are returned separately and NEVER folded into a bucket:
// they are the strangers, and pretending otherwise is the merge hazard above.
export function groupByEntity(descriptors = [], opts = {}) {
  const groups = new Map();
  const unresolved = [];
  for (const d of descriptors || []) {
    const r = resolveVendorIdentity(d, opts);
    // A descriptor that normalizes but matches nothing still has a stable key of its
    // own — that is what lets a first-time vendor accrue history under one identity.
    const key = r.entityKey || r.normalized;
    if (!key) { unresolved.push(r.rawDescriptor); continue; }
    if (!groups.has(key)) groups.set(key, { entityKey: key, matchedVia: r.matchedVia, descriptors: [] });
    groups.get(key).descriptors.push(r.rawDescriptor);
  }
  return { groups: [...groups.values()], unresolved };
}
