// ─────────────────────────────────────────────────────────────────────────────
// C201 — THE VENDOR STATE MACHINE (O88 build surface 3).
//
// KNOWN / DECLARED / UNIVERSAL / STRANGER as a PERSISTED STATE with explicit
// transitions. Implements `docs/CALIBRATION_SPEC_O88.md` Q1–Q3; every rule below is
// quoting that document and this file has no authority to invent one.
//
// ★ THE POINT OF MAKING IT A STATE. Confidence recomputed a verdict every month from
// whatever the descriptor looked like that day, which is why Lone Star produced four
// months and four different verdicts (§11 O87 (iv)) — nothing was remembered, so
// nothing could be stable. A tier is a fact about what a human has attested, stored
// once and changed only by the three transitions below. Descriptor noise cannot move
// it, because descriptor noise is not evidence about a vendor.
//
// ★ WHAT THIS FILE MAY NOT DO. It never returns an account and never books. It answers
// "how well do we know this vendor, and what did a human attest for it" — the caller
// (C203) decides what to do with that. Keeping the tier and the booking apart is what
// stops "recognition" quietly becoming "plausibility" again.
//
// PURE. No I/O, no clock of its own: every function that needs "now" takes it as an
// argument, so dormancy decay is testable and never depends on when the suite runs.
// ─────────────────────────────────────────────────────────────────────────────

export const VENDOR_TIER = {
  KNOWN: "KNOWN",           // graduated: two attested observations, two distinct months
  DECLARED: "DECLARED",     // attested in the onboarding census; no graduation yet
  UNIVERSAL: "UNIVERSAL",   // curated global directory hit; no company attestation yet
  STRANGER: "STRANGER",     // no history, no census, no directory
};

// Q3 — the exhaustive demotion reasons. Anything not on this list may not demote.
export const DEMOTION_REASON = {
  MAPPING_CORRECTION: "mapping_correction",   // CPA corrected the account → immediate
  DORMANCY: "dormancy",                       // unseen 6 months → decay to DECLARED
};

// Q1 — graduation needs this many attested observations in this many DISTINCT
// statement-months. Same-month repetition never accelerates the clock.
export const GRADUATION_OBSERVATIONS = 2;
export const GRADUATION_DISTINCT_MONTHS = 2;

// Q3 — unseen this long decays KNOWN → DECLARED. Identity survives; pattern data is
// stale, so the norm it would supply is no longer worth trusting.
export const DORMANCY_MONTHS = 6;

// Q2 — the floor on a derived band. A vendor whose observed amounts happen to be
// identical would otherwise get a zero-width band and flag on a one-cent difference;
// the band is a NOTIFICATION boundary, and a boundary nobody can stay inside is noise.
export const MIN_BAND_FRACTION = 0.05;

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const monthOf = (d) => String(d || "").slice(0, 7);
const isYm = (m) => /^\d{4}-\d{2}$/.test(String(m || ""));

// Months between two YYYY-MM strings. Calendar arithmetic, no Date, no timezone.
export function monthsBetween(fromYm, toYm) {
  if (!isYm(fromYm) || !isYm(toYm)) return null;
  const [fy, fm] = fromYm.split("-").map(Number);
  const [ty, tm] = toYm.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

// ── Q2 — THE AMOUNT BAND, DERIVED FROM OBSERVED VARIANCE ─────────────────────
// NOT a flat ±%. "A produce vendor with legitimate seasonal swing earns a wide band;
// a fixed-fee linen service earns a tight one" (Axis 2). Mean ± 2σ, floored so a
// perfectly regular vendor still gets breathing room.
//
// The band informs FLAG COPY ONLY. It never gates booking — a bank line is a fact and
// facts book (Rule 1). An out-of-band line books and flags; attesting the flag
// re-anchors the pattern.
export function amountBand(amounts = []) {
  const xs = (amounts || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!xs.length) return null;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const variance = xs.length < 2 ? 0 : xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1);
  const sd = Math.sqrt(variance);
  const halfWidth = Math.max(2 * sd, mean * MIN_BAND_FRACTION);
  return { mean: r2(mean), sd: r2(sd), low: r2(Math.max(0, mean - halfWidth)), high: r2(mean + halfWidth), n: xs.length };
}

export function isWithinBand(amount, band) {
  if (!band) return null;               // no band ⇒ no opinion, which is not "in band"
  const a = Math.abs(Number(amount) || 0);
  return a >= band.low && a <= band.high;
}

// How far out, for the flag copy. "2.4x this vendor's attested pattern" (Q9) — a
// multiple of the MEAN, which is the number a human can check, not of the band edge.
export function bandMultiple(amount, band) {
  if (!band || !(band.mean > 0)) return null;
  return Math.round((Math.abs(Number(amount) || 0) / band.mean) * 10) / 10;
}

// ── Q1 — GRADUATION ──────────────────────────────────────────────────────────
// `observations`: [{ month: "YYYY-MM", account_id, amount, attested: bool }].
// ONLY ATTESTED observations count. An unattested booking is the machine agreeing with
// itself, which is the ·3a failure in a different costume.
//
// The three conditions, all required:
//   1. at least GRADUATION_OBSERVATIONS attested observations;
//   2. across at least GRADUATION_DISTINCT_MONTHS distinct statement-months;
//   3. AGREEING mapping — every attested observation on the same account.
// Condition 3 is deliberately strict: a vendor whose attested account has moved is a
// vendor we do not yet understand, whatever the count says.
export function graduationStatus(observations = []) {
  const attested = (observations || []).filter((o) => o && o.attested && isYm(o.month) && o.account_id != null);
  const months = new Set(attested.map((o) => o.month));
  const accounts = new Set(attested.map((o) => String(o.account_id)));
  const enough = attested.length >= GRADUATION_OBSERVATIONS;
  const spread = months.size >= GRADUATION_DISTINCT_MONTHS;
  const agree = accounts.size === 1;
  return {
    graduates: enough && spread && agree,
    attestedCount: attested.length,
    distinctMonths: months.size,
    agreeingMapping: agree,
    attestedAccountId: accounts.size === 1 ? [...accounts][0] : null,
    // Why not, in the order a human would ask. Empty when it graduates.
    blockers: [
      !enough && `only ${attested.length} attested observation${attested.length === 1 ? "" : "s"}`,
      enough && !spread && `all ${attested.length} attested observations fall in ${months.size} statement-month${months.size === 1 ? "" : "s"}`,
      !agree && accounts.size > 1 && `attested to ${accounts.size} different accounts`,
    ].filter(Boolean),
  };
}

// ── Q3 — DEMOTION AND DECAY ──────────────────────────────────────────────────
// AMOUNT BEHAVIOUR NEVER DEMOTES AND NEVER PAUSES. There is deliberately no function
// here that takes an amount and lowers a tier. An out-of-band line books and flags;
// one attestation cures. If a future edit adds an amount-driven demotion, it has
// contradicted Q3 and the tier stops being a fact about knowledge.
export function applyMappingCorrection(state = {}, { correctedAccountId, at } = {}) {
  return {
    ...state,
    tier: VENDOR_TIER.DECLARED,
    attested_account_id: correctedAccountId != null ? String(correctedAccountId) : state.attested_account_id,
    demoted_at: at || null,
    demotion_reason: DEMOTION_REASON.MAPPING_CORRECTION,
    // The clock restarts: prior observations attested a mapping that turned out wrong,
    // so they are not evidence for the new one.
    observations: [],
  };
}

export function applyDormancy(state = {}, asOfYm) {
  if (state.tier !== VENDOR_TIER.KNOWN) return state;
  const gap = monthsBetween(monthOf(state.last_seen), asOfYm);
  if (gap == null || gap < DORMANCY_MONTHS) return state;
  // Identity survives; only the pattern is stale. Observations are KEPT so the vendor
  // can re-graduate on its next two months rather than starting from nothing.
  return { ...state, tier: VENDOR_TIER.DECLARED, demoted_at: asOfYm, demotion_reason: DEMOTION_REASON.DORMANCY };
}

// ── THE LADDER ───────────────────────────────────────────────────────────────
// Resolve a tier from what is known. Order is the spec's order and is load-bearing:
// company attestation outranks the census, which outranks the curated directory,
// which outranks nothing at all.
export function resolveTier({ state = null, inCensus = false, inDirectory = false } = {}) {
  if (state && state.tier === VENDOR_TIER.KNOWN) return VENDOR_TIER.KNOWN;
  if (state && state.tier === VENDOR_TIER.DECLARED) return VENDOR_TIER.DECLARED;
  if (inCensus) return VENDOR_TIER.DECLARED;
  if (inDirectory) return VENDOR_TIER.UNIVERSAL;
  return VENDOR_TIER.STRANGER;
}

// Fold one new ATTESTED observation into a state, running graduation. Unattested
// observations are recorded for pattern data but never graduate anything.
export function recordObservation(state = {}, obs = {}) {
  const next = {
    ...state,
    entity_key: state.entity_key ?? obs.entity_key ?? null,
    observations: [...(state.observations || []), obs],
    last_seen: obs.month && obs.month > String(state.last_seen || "") ? obs.month : state.last_seen || obs.month || null,
    first_seen: state.first_seen || obs.month || null,
  };
  const g = graduationStatus(next.observations);
  if (g.graduates) {
    next.tier = VENDOR_TIER.KNOWN;
    next.attested_account_id = g.attestedAccountId;
    next.demoted_at = null;
    next.demotion_reason = null;
  } else if (!next.tier) {
    next.tier = VENDOR_TIER.STRANGER;
  }
  const amounts = (next.observations || []).filter((o) => o && o.attested).map((o) => o.amount);
  next.band = amountBand(amounts);
  return next;
}

// The row shape persisted by migration 064. Pure builder so the shape is assertable
// without a database — the ·3a lesson: the poster's output must be readable by the
// consumer, and the only way to hold that is to test the actual shape.
export function vendorStateRow(state = {}, { companyId } = {}) {
  return {
    company_id: companyId,
    entity_key: state.entity_key == null ? null : String(state.entity_key),
    tier: state.tier || VENDOR_TIER.STRANGER,
    attested_account_id: state.attested_account_id == null ? null : String(state.attested_account_id),
    observation_count: (state.observations || []).length,
    distinct_months: [...new Set((state.observations || []).filter((o) => o && o.attested).map((o) => o.month))].sort(),
    first_seen: state.first_seen || null,
    last_seen: state.last_seen || null,
    amount_mean: state.band ? state.band.mean : null,
    amount_sd: state.band ? state.band.sd : null,
    demoted_at: state.demoted_at || null,
    demotion_reason: state.demotion_reason || null,
  };
}
