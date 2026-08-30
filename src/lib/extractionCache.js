// ─────────────────────────────────────────────────────────────────────────────
// REUSING WHAT WE ALREADY READ FROM A DOCUMENT (O113, proposal 3 — accepted 2026-08-26).
//
// Re-uploading identical bytes re-runs the whole pipeline. C193 already computes a SHA-256
// of every document to dedupe the library, so the key exists and costs nothing new; the
// August drive re-uploaded twice, so this is a real path rather than a hypothetical one.
//
// ★★★ AND THE WHOLE DESIGN IS IN WHICH CALLS MAY BE CACHED, NOT IN THE CACHING.
//
//   · **classify** ("is this an invoice?") — a property OF THE BYTES. Cacheable.
//   · **extract**  (vendor, amount, date, line items) — a property OF THE BYTES. Cacheable.
//   · **code**     (which account this belongs to) — **a property of THE COMPANY'S CHART**,
//     which changes: accounts get added (C223/C254 added several today), renamed, and
//     learned mappings move. **CACHING IT WOULD PIN A BOOKING DECISION TO A CHART THAT NO
//     LONGER EXISTS** — the same document re-uploaded after a chart change would book to
//     yesterday's answer, silently, and look identical to a correct one. **NEVER CACHED.**
//
// ★★ THE VERSION KEY IS WHAT STOPS A CACHE OUTLIVING THE THING IT CACHED. If the extraction
// prompt changes, every stored answer was produced by a model that no longer exists in this
// system — reusing it would make a prompt fix invisible on exactly the documents most likely
// to be re-uploaded. Bump the version and the cache empties itself.
//
// Pure.
// ─────────────────────────────────────────────────────────────────────────────

// ★ BUMP THIS WHEN THE CLASSIFY OR EXTRACT PROMPT CHANGES. Not a date, not a hash of the
// prompt file — a deliberate declaration, so the person changing the prompt has to decide
// whether old answers are still good. An automatic key would silently invalidate on a typo
// fix and silently keep on a semantic change; only a human can tell those apart.
export const EXTRACTION_VERSION = "v1";

export const CACHEABLE = {
  CLASSIFY: "classify",   // what kind of document this is — a property of the bytes
  EXTRACT: "extract",     // vendor, amount, date, lines — a property of the bytes
};

// Deliberately not exported as a cacheable kind, and named so the omission is visible rather
// than an oversight: the account a charge belongs to depends on the company's chart.
export const NEVER_CACHED = ["code"];

// Is this stored extraction usable? Returns the reason when it is not, so a caller can say
// why it re-read a document rather than reporting a silent miss.
export function usableExtraction(doc = {}, { version = EXTRACTION_VERSION } = {}) {
  if (!doc || !doc.extraction) return { ok: false, reason: "none" };
  if (doc.extraction_version !== version) return { ok: false, reason: "stale_version" };
  const e = doc.extraction;
  if (typeof e !== "object") return { ok: false, reason: "unreadable" };
  // ★ A CACHE ENTRY THAT CANNOT ANSWER THE QUESTION IS A MISS, NOT A HIT. An empty object
  // would otherwise short-circuit the pipeline into "we read this and found nothing", which
  // is the O98 shape with an AI call's worth of cost saved and the answer thrown away.
  if (!e[CACHEABLE.CLASSIFY] && !e[CACHEABLE.EXTRACT]) return { ok: false, reason: "empty" };
  return { ok: true, reason: null, extraction: e };
}

// What to store after a fresh read. Only the two byte-derived answers, never the coding.
export function extractionToStore({ classify = null, extract = null } = {}) {
  const out = {};
  if (classify != null) out[CACHEABLE.CLASSIFY] = classify;
  if (extract != null) out[CACHEABLE.EXTRACT] = extract;
  return Object.keys(out).length ? out : null;
}

// ★ THE SENTENCE, DERIVED FROM THE OUTCOME (§9). A cache hit is worth saying out loud: the
// person watching a re-upload should know why it was instant, or they will wonder whether
// it did anything at all — the O128 shape, where the best outcome read as a null result.
export function cacheHitCopy(doc = {}) {
  const name = (doc && doc.name) || "that file";
  return `We'd already read ${name}, so we reused it instead of reading it again.`;
}
