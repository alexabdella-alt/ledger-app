// ─────────────────────────────────────────────────────────────────────────────
// C201 — HISTORICAL VENDOR-STATE BACKFILL (the work "065" was reserved for).
//
// ★★ THIS IS NOT A MIGRATION, AND THAT IS THE FINDING, NOT A SHORTCUT.
//
// The backfill must group historical bank lines by VENDOR IDENTITY, and identity is
// `normalizeDescriptor` in `src/lib/vendorIdentity.js` (C200): rail-prefix stripping,
// stacked-tail stripping, `normalizeName`'s legal-suffix rules, and a letters-required
// guard. Writing that in SQL would produce a SECOND implementation of the identity
// contract — and the two would drift, silently, exactly as ·3b(f3) re-keyed
// fingerprints while ·3b(f1) kept reading the old shape and the two halves disagreed
// in the same commit. A backfill that groups vendors differently from the way the app
// groups them would seed a state machine whose keys the app cannot look up: inert on
// arrival, and green.
//
// So the identity function stays the single implementation and this planner runs in
// JS against rows read out of the database. `065` is released back to the pool.
//
// PURE. Takes rows, returns rows. No I/O, no clock — the caller supplies `asOfMonth`.
// The executor (one-off, operator-triggered) does the reading and the upserting.
// ─────────────────────────────────────────────────────────────────────────────

import { entityKeyFor } from "./vendorIdentity.js";
import { recordObservation, vendorStateRow, applyDormancy, VENDOR_TIER } from "./vendorTier.js";

// Q6/decision 2026-08-23 — HOW A HISTORICAL LINE COUNTS.
// "A month's sign-off attests every line as it stood at signing." So an observation
// counts toward Q1 graduation iff its line sits in a SIGNED month, and the mapping it
// counts toward is the account the line held AT SIGN-OFF.
//
// Strength is recorded but is NOT a gate — both kinds count toward the clock:
//   EXPLICIT — a human touched this line directly (exception resolution, or a recode).
//   IMPLICIT — auto-booked inside a month a human later signed.
// Recorded because the two are not equally strong evidence and a future calibration
// question ("should implicit-only vendors graduate?") should be answerable from data
// rather than re-derived. It is informational today, by decision, and the tests hold
// that it does not gate.
export const ATTESTATION_STRENGTH = { EXPLICIT: "explicit", IMPLICIT: "implicit" };

export function attestationStrengthFor(line = {}) {
  return (line.exception_resolved || line.recoded) ? ATTESTATION_STRENGTH.EXPLICIT : ATTESTATION_STRENGTH.IMPLICIT;
}

const monthOf = (d) => String(d || "").slice(0, 7);

// ── ★ THE OPEN-BOOK PROBLEM (found by the operator, 2026-08-23) ──────────────
// `journal_entries.description` on a bank line is NOT the raw bank descriptor. It is
// `"Resolved Vendor Name – RAW BANK TEXT"`, en-dash separated — `ledger.js:31` relies
// on the same split, taking the LEFT half as the display vendor.
//
// Resolving identity from the FULL string would grade identity resolution against a
// string that already contains the answer. Every variant would resolve perfectly
// because the resolved name is sitting right there in the input, and the backfill
// would report flawless grouping while proving nothing about the function under test.
// An open-book exam, scored as if it were closed-book.
//
// So: split, take the RIGHT half, and when there is no separator DO NOT fall back to
// the whole string — that is the contaminated case in disguise. Those rows are
// excluded and COUNTED, so the preview shows how much of the corpus could not be read
// honestly rather than quietly scoring what it could.
const RAW_SEP = " – ";
export function rawDescriptorOf(description) {
  const s = String(description == null ? "" : description);
  const i = s.indexOf(RAW_SEP);
  if (i < 0) return null;                       // no separator ⇒ cannot tell raw from resolved
  const right = s.slice(i + RAW_SEP.length).trim();
  return right || null;
}

// Plan the backfill. `lines` are historical bank-sourced journal lines:
//   { line_id, descriptor, date, account_id, exception_resolved?, recoded?, deleted? }
// `signedMonths` is the set of attested periods ('YYYY-MM') for the company.
//
// Lines in UNSIGNED months are excluded entirely — not counted, not recorded. There is
// no answer key for them, and seeding a state machine from unattested bookings would be
// the machine graduating vendors on its own say-so, which is the ·3a failure wearing a
// backfill's clothes.
export function planVendorBackfill({ lines = [], signedMonths = [], companyId = null, asOfMonth = null } = {}) {
  const signed = new Set((signedMonths || []).map(String));
  const skipped = { unsigned_month: 0, deleted: 0, no_identity: 0, no_account: 0, ambiguous_descriptor: 0 };
  const byEntity = new Map();

  for (const line of lines || []) {
    if (!line) continue;
    if (line.deleted) { skipped.deleted += 1; continue; }
    const month = monthOf(line.date);
    if (!signed.has(month)) { skipped.unsigned_month += 1; continue; }
    if (line.account_id == null) { skipped.no_account += 1; continue; }
    // RIGHT HALF ONLY — see rawDescriptorOf. A row we cannot split is excluded rather
    // than scored against a string containing its own answer.
    const raw = rawDescriptorOf(line.descriptor);
    if (!raw) { skipped.ambiguous_descriptor += 1; continue; }
    const entity_key = entityKeyFor(raw);
    if (!entity_key) { skipped.no_identity += 1; continue; }

    if (!byEntity.has(entity_key)) byEntity.set(entity_key, { entity_key, observations: [], descriptors: new Set() });
    const g = byEntity.get(entity_key);
    g.descriptors.add(raw);   // the RAW text, not the resolved-name-bearing original
    g.observations.push({
      month, account_id: String(line.account_id), amount: Math.abs(Number(line.amount) || 0),
      attested: true,                                   // signed month ⇒ attested, per the decision above
      strength: attestationStrengthFor(line),
      line_id: line.line_id,
    });
  }

  // Fold each entity's observations through the REAL state machine — same code that
  // will run live, so a vendor cannot graduate in the backfill by a rule the app does
  // not use. Observations are applied oldest-first so `last_seen` lands correctly.
  const states = [];
  for (const g of byEntity.values()) {
    let state = { entity_key: g.entity_key };
    for (const o of g.observations.slice().sort((a, b) => a.month.localeCompare(b.month))) {
      state = recordObservation(state, o);
    }
    // Q3 — a vendor that graduated historically but has been silent for six months
    // decays on arrival rather than being seeded KNOWN on stale pattern data.
    if (asOfMonth) state = applyDormancy(state, asOfMonth);
    states.push({ state, descriptors: [...g.descriptors] });
  }

  // ★ CORPUS VARIANCE — does this data exercise identity resolution AT ALL?
  // A vendor whose raw text is byte-identical every month tests nothing: normalisation
  // has no work to do, and a clean grouping result would be an artefact of the fixture
  // rather than evidence about the function. Reported so a clean preview can never be
  // read as "identity resolution works".
  const variance = states.map(({ state, descriptors }) => ({
    entity_key: state.entity_key, distinctRawDescriptors: descriptors.length,
  }));
  const exercised = variance.filter((v) => v.distinctRawDescriptors > 1).length;

  return {
    rows: states.map(({ state }) => vendorStateRow(state, { companyId })),
    states,
    skipped,
    variance: {
      vendorsWithMultipleRawDescriptors: exercised,
      totalVendors: variance.length,
      // TRUE when every vendor arrived under exactly one raw string — i.e. the corpus
      // cannot exercise normalisation, whatever the grouping result looks like.
      identityResolutionUnexercised: variance.length > 0 && exercised === 0,
      perVendor: variance,
    },
    counts: {
      entities: states.length,
      graduating: states.filter(({ state }) => state.tier === VENDOR_TIER.KNOWN).length,
      observations: [...byEntity.values()].reduce((s, g) => s + g.observations.length, 0),
    },
  };
}

// ── THE PREVIEW ──────────────────────────────────────────────────────────────
// What graduates at deploy, in plain rows, so it can be checked against a human's
// memory of the fixtures BEFORE anything is written. Sorted graduating-first, then by
// observation count, so the interesting rows are at the top.
export function graduationPreview(plan = {}) {
  return (plan.states || [])
    .map(({ state, descriptors }) => ({
      entity_key: state.entity_key,
      tier: state.tier,
      observations: (state.observations || []).length,
      distinct_months: [...new Set((state.observations || []).map((o) => o.month))].sort(),
      attested_account_id: state.attested_account_id || null,
      explicit: (state.observations || []).filter((o) => o.strength === ATTESTATION_STRENGTH.EXPLICIT).length,
      implicit: (state.observations || []).filter((o) => o.strength === ATTESTATION_STRENGTH.IMPLICIT).length,
      amount_mean: state.band ? state.band.mean : null,
      descriptors,
      // Why NOT, for the ones that miss — the useful half of a preview.
      blocked_by: state.tier === VENDOR_TIER.KNOWN ? null : blockersFor(state),
    }))
    .sort((a, b) => (a.tier === b.tier ? b.observations - a.observations : a.tier === VENDOR_TIER.KNOWN ? -1 : 1));
}

function blockersFor(state) {
  const obs = state.observations || [];
  const months = new Set(obs.map((o) => o.month));
  const accounts = new Set(obs.map((o) => String(o.account_id)));
  if (obs.length < 2) return `only ${obs.length} attested observation${obs.length === 1 ? "" : "s"} in signed months`;
  if (months.size < 2) return `all ${obs.length} observations fall in ${[...months][0]}`;
  if (accounts.size > 1) return `attested to ${accounts.size} different accounts`;
  if (state.demotion_reason) return `decayed on arrival (${state.demotion_reason})`;
  return "unknown";
}
