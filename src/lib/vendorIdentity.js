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
import { matchDirectory } from "./vendorDirectory.js";

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
  // ★ O119 FOLLOW-ON, AND THE TEST FOUND IT RATHER THAN THE AUTHOR. Mapping `+` to the
  // word "and" (docDirection.normalizeName) made a NEW phantom reachable: `"+"` used to
  // normalize to `"+"`, carry no letters, and correctly resolve to nothing — now it
  // normalizes to `"and"`, which has letters and would have minted an entity keyed on the
  // joining word itself. So the letters test ignores the joiner: a descriptor made only of
  // joiners is no more a vendor than a bare trace number is.
  const meaningful = n.replace(/\band\b/g, " ").trim();
  return /[a-z]/.test(meaningful) ? n : "";
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

  // 3. DIRECTORY — curated, binary, global. Accepts BOTH the legacy inline shape
  //    ({entityKey, patterns}) and a `universal_vendor_directory` row
  //    ({entity_key, match_patterns, match_type}); the matching itself lives in
  //    `vendorDirectory.matchDirectory` so there is ONE matcher, not two that drift.
  const dirEntries = (directory || []).map((d) => (d && d.entity_key)
    ? d
    : { entity_key: d && d.entityKey, match_patterns: (d && d.patterns) || [], match_type: "exact", active: true });
  const hit = matchDirectory(raw, dirEntries);
  if (hit) {
    return { entityKey: String(hit.entity_key), matchedVia: MATCH_SOURCE.DIRECTORY, rawDescriptor: raw, normalized };
  }

  return miss;
}

// ═════════════════════════════════════════════════════════════════════════════
// PER-SOURCE IDENTITY STRATEGY (approved 2026-08-25).
//
// ONE RULE FOR ALL SOURCES WAS WRONG, and silently so on two of four. The entry
// description is a DISPLAY STRING assembled from structured data, and it is assembled
// by two different paths that do not know about each other:
//   • `persistJournalEntry` (App.jsx:1386) → `${vendor} – ${description}`, vendor LEFT
//   • `persistMultiLineEntry` (App.jsx:1482) → `entry.description` VERBATIM
// so payroll keeps `Gusto Payroll — 2026-02-28 – 2026-03-13` (em-dash after the
// vendor, EN-dash between the dates) and a naive " – " split lands on the date range.
//
// ★ THE REFRAME THAT MAKES THIS TRACTABLE: only ONE source has a descriptor problem.
// Rail-stripping exists because BANK descriptors are noisy. The other sources carry a
// vendor as structured data and never had variants to resolve — so the open-book
// objection does not apply to them, because there is nothing to resolve. Reading a
// vendor field is not cheating on a test the field was never sitting for.
// ═════════════════════════════════════════════════════════════════════════════

export const IDENTITY_STRATEGY = {
  RESOLVE: "resolve",   // noisy bank text on the RIGHT — rail-strip then normalize
  READ:    "read",      // clean vendor on the LEFT — normalize only, no rail-stripping
  EXCLUDE: "exclude",   // not a vendor→account judgement at all
};

// `identity_source` on an observation: was the identity RESOLVED (the resolver did
// work and could be wrong) or merely READ (a field, and cannot be)? Shadow-mode
// scoring reports these separately and prominently — a PROCEED resting mostly on READ
// identities has not tested the resolver, and the report must be structurally unable
// to hide that.
export const SOURCE_STRATEGY = {
  bank_import:      IDENTITY_STRATEGY.RESOLVE,
  universal_upload: IDENTITY_STRATEGY.READ,
  manual:           IDENTITY_STRATEGY.READ,
  recurring:        IDENTITY_STRATEGY.READ,
  qbo_import:       IDENTITY_STRATEGY.READ,
  // EXCLUDED, each for a stated reason rather than by omission:
  payroll:          IDENTITY_STRATEGY.EXCLUDE,   // books by STRUCTURE, no mapping to learn
  opening_balance:  IDENTITY_STRATEGY.EXCLUDE,   // a position, not a purchase
  ar_invoice:       IDENTITY_STRATEGY.EXCLUDE,   // customer side; not a vendor
  api:              IDENTITY_STRATEGY.EXCLUDE,   // provenance unknown — conservative
};

// An UNRECOGNISED source is EXCLUDED and counted, never guessed at. A wrong entity key
// merges two vendors and launders one's attested mapping onto the other's charges
// (Q4's one-way door); a missing one merely books to suspense and flags. The two errors
// are not symmetric, so the default takes the recoverable side.
export function strategyForSource(source) {
  return SOURCE_STRATEGY[String(source || "")] || IDENTITY_STRATEGY.EXCLUDE;
}

const SEP = " – ";   // EN-dash, as written by App.jsx:1386

// RIGHT half — the raw bank text. Null when there is no separator, because falling
// back to the whole string would score the resolver against a string containing the
// resolved vendor name: an open-book exam marked as closed-book.
export function rightHalf(description) {
  const s = String(description == null ? "" : description);
  const i = s.indexOf(SEP);
  if (i < 0) return null;
  return s.slice(i + SEP.length).trim() || null;
}

// LEFT half — the vendor field. When there is no separator the WHOLE string is the
// vendor, which is a legitimate shape here (unlike the right-half case) because
// nothing has been concatenated onto it.
export function leftHalf(description) {
  const s = String(description == null ? "" : description).trim();
  if (!s) return null;
  const i = s.indexOf(SEP);
  return (i < 0 ? s : s.slice(0, i).trim()) || null;
}

// READ — normalize ONLY. No rail-stripping: a vendor field has no rails on it, and
// running the strip would risk eating a real name ("Sysco Foods TX" is a vendor whose
// name ends in two letters, not a state-code tail).
export function readIdentity(vendorField) {
  const n = normalizeName(String(vendorField || "")) || "";
  return /[a-z]/.test(n) ? n : null;
}

// The single entry point. Returns { entity_key, identity_source, raw, strategy } — or
// { excluded: <reason> } when this entry carries no vendor→account judgement to learn.
export function identityForEntry({ description, source } = {}) {
  const strategy = strategyForSource(source);
  if (strategy === IDENTITY_STRATEGY.EXCLUDE) {
    return { excluded: `source_${String(source || "unknown")}`, strategy };
  }
  if (strategy === IDENTITY_STRATEGY.RESOLVE) {
    const raw = rightHalf(description);
    if (!raw) return { excluded: "no_raw_half", strategy };
    const entity_key = entityKeyFor(raw);
    if (!entity_key) return { excluded: "no_identity", strategy };
    return { entity_key, identity_source: IDENTITY_STRATEGY.RESOLVE, raw, strategy };
  }
  const field = leftHalf(description);
  if (!field) return { excluded: "no_vendor_field", strategy };
  const entity_key = readIdentity(field);
  if (!entity_key) return { excluded: "no_identity", strategy };
  return { entity_key, identity_source: IDENTITY_STRATEGY.READ, raw: field, strategy };
}

// ─────────────────────────────────────────────────────────────────────────────
// O125 — THE DISPLAY LAYER'S TWO QUESTIONS, WHICH ARE NOT THE SAME QUESTION.
//
// `flattenJournalEntries` derived the vendor as `description.split(" – ")[0]` — an
// IDENTITY DECISION, made in the display layer, by punctuation. Three live symptoms, all
// on the screen that is the only route to Delete:
//   (1) **Gusto rendered as FIFTEEN separate vendors** — payroll writes an EM-dash before
//       the period (`Gusto Payroll — 2026-08-15 – 2026-08-28`), so an en-dash-only split
//       missed and the pay period became part of the name.
//   (2) **A trailing full stop split a vendor in two** — `Hill Country Milling Co` and
//       `…Co.` were different vendors, on a screen where the vendor list IS the navigation.
//   (3) **Reversals got their own vendor** (`REVERSAL: Hill Country Milling Co.`), so the
//       original's total was overstated and the reversal sat under a name of its own.
//
// ★★ THE ROOT CAUSE IS THAT ONE STRING WAS DOING TWO JOBS. A vendor needs a NAME a human
// reads and a KEY the system groups by, and they have opposite requirements: the name must
// keep its capitals, its punctuation and its legal suffix; the key must throw all three
// away. Deriving one from the other by a split gets both wrong.
//
// ★ AND THIS IS WHY IT IS HERE AND NOT IN `ledger.js`. The repo already carries three
// implementations of vendor identity because each caller wrote its own — the very reason
// migration `065` was released ("the backfill cannot be SQL: it would be a second
// implementation of the identity contract"). We declined to write one in SQL and then
// shipped two in JS. This is the resolver; the display layer calls it.
// ─────────────────────────────────────────────────────────────────────────────

// A SPACED en-dash or em-dash separates the vendor from whatever was appended to it.
// BOTH, because the two description builders disagree: `persistJournalEntry` writes
// `Vendor – detail` (en) while `payrollEntryForImport` writes `Gusto Payroll — start – end`
// (em, then en). Splitting on the FIRST of either is what makes payroll one vendor.
// Unspaced dashes are left alone — `12/05/2025–01/05/2026` is a date range, not a break.
const DISPLAY_SEP = /\s[–—]\s/;

// The name a human reads: original case, punctuation intact, everything after the first
// separator dropped. `REVERSAL:` is stripped so a reversal files under the entry it
// reverses rather than inventing a vendor — the total then nets to zero, which is the
// arithmetic truth of a reversed charge.
export function displayVendorName(description) {
  let s = String(description == null ? "" : description).trim();
  if (!s) return null;
  s = s.replace(/^reversal:\s*/i, "").trim();
  const m = s.split(DISPLAY_SEP);
  const name = (m[0] || "").trim();
  return name || null;
}

// The key the system GROUPS by. Normalised hard — case, trailing full stop, legal suffix,
// `&`/`+` — so `Hill Country Milling Co` and `Hill Country Milling Co.` are one vendor.
// Returns null when nothing identity-bearing survives, and callers must fall back to the
// display name rather than grouping every such row together under "".
export function vendorGroupKey(description) {
  const name = displayVendorName(description);
  return name ? entityKeyFor(name) : null;
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
