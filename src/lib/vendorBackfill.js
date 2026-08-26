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

import { identityForEntry, IDENTITY_STRATEGY } from "./vendorIdentity.js";
import { isPayrollBankLine } from "./payroll.js";
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

// ★★ AN ATTESTATION IS SCOPED TO THE QUESTION THAT WAS ASKED (CLAUDE.md §9, O114).
// Not every exception a human resolves is a judgment about the ACCOUNT. Answering
// "are these two documents the same purchase?" is a judgment about DOCUMENT IDENTITY
// — the human need not have seen the account, and attaching does not change it. So
// the exception KIND decides, not the mere fact that a human clicked.
//
// Amendment B's backfill bar is ">= 1 explicit". Without this exclusion a vendor would
// graduate to KNOWN on PAPERWORK VOLUME, with `attested_account_id` set to whatever
// the machine happened to book — the machine attesting to its own guess through a
// human's click on an unrelated question, routing around the amendment within one
// release of it being signed.
//
// A SET, not a special case, because this is the SECOND instance of the rule (the
// first: signing a month is not examining a vendor) and there will be a third.
export const NON_ATTESTING_EXCEPTIONS = new Set(["invoice_payment_match"]);

export function attestationStrengthFor(line = {}) {
  // A RECODE always attests: a human looked at the account and changed it. When a
  // match resolution ALSO recodes, the attestation attaches to the recode — two
  // events, two facts, and only one of them touches the familiarity clock.
  if (line.recoded) return ATTESTATION_STRENGTH.EXPLICIT;
  if (line.exception_resolved && !NON_ATTESTING_EXCEPTIONS.has(line.exception_kind)) {
    return ATTESTATION_STRENGTH.EXPLICIT;
  }
  return ATTESTATION_STRENGTH.IMPLICIT;
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
const RAW_SEP = " – ";   // kept: rawDescriptorOf is still exported and tested
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
  // Skip reasons are open-ended now: `source_payroll`, `source_opening_balance`,
  // `no_raw_half`, `no_vendor_field`, `no_identity`… Each is counted by name so an
  // excluded population can never be a silent one.
  const skipped = { unsigned_month: 0, deleted: 0, no_account: 0 };
  const byEntity = new Map();

  for (const line of lines || []) {
    if (!line) continue;
    if (line.deleted) { skipped.deleted += 1; continue; }
    const month = monthOf(line.date);
    if (!signed.has(month)) { skipped.unsigned_month += 1; continue; }
    if (line.account_id == null) { skipped.no_account += 1; continue; }
    // PER-SOURCE (approved 2026-08-25). bank_import RESOLVEs the noisy right half;
    // universal_upload/manual/recurring/qbo_import READ the clean left half; payroll,
    // opening_balance, ar_invoice and api are EXCLUDED because they carry no
    // vendor→account judgement to learn. An unrecognised source is excluded and counted.
    const ident = identityForEntry({ description: line.descriptor, source: line.source });
    if (ident.excluded) { skipped[ident.excluded] = (skipped[ident.excluded] || 0) + 1; continue; }
    // ── PAYROLL ARRIVES ON THE BANK RAIL TOO (found by the 2026-08-25 re-run) ──
    // Checked AFTER the source exclusion so the counters stay honest: a payroll
    // REGISTER entry is `source_payroll`, a net-pay BANK line is `payroll_bank_line`.
    // Ordering them the other way round labelled register entries as bank lines —
    // caught by a test that had asserted the more specific counter.
    // Excluding `source='payroll'` removes the REGISTER entries, but the net-pay debit
    // shows up as an ordinary `bank_import` line. Franklin Ave's Jan/Feb Gusto lines are
    // exactly that, and without this they survive as a `gusto payroll` entity at 3,150
    // NET — while the register books 4,000 GROSS from March. One entity, two paths
    // measuring different quantities, and a spurious 1.27x band event: precisely the
    // half of the net-vs-gross mismatch the source exclusion was meant to prevent.
    //
    // Reuses the EXISTING predicate rather than growing a second definition of "this is
    // payroll" — the ·3b(f3) lesson about two halves of one contract drifting apart.
    if (isPayrollBankLine({ vendor: line.vendor, description: line.descriptor })) {
      skipped.payroll_bank_line = (skipped.payroll_bank_line || 0) + 1;
      continue;
    }
    const { entity_key, identity_source, raw } = ident;

    if (!byEntity.has(entity_key)) byEntity.set(entity_key, { entity_key, observations: [], descriptors: new Set() });
    const g = byEntity.get(entity_key);
    g.descriptors.add(raw);   // the RAW text, not the resolved-name-bearing original
    g.observations.push({
      month, account_id: String(line.account_id), amount: Math.abs(Number(line.amount) || 0),
      attested: true,                                   // signed month ⇒ attested, per the decision above
      strength: attestationStrengthFor(line),
      // RESOLVED (the resolver did work and could be wrong) vs READ (a field, and
      // cannot be). Carried per observation so shadow scoring can report them apart —
      // a PROCEED resting mostly on READ identities has not tested the resolver.
      identity_source,
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

    // ── ★ AMENDMENT B (signed 2026-08-25) — THE BACKFILL GRADUATION BAR ────────
    // A vendor graduates from HISTORY only if at least one qualifying observation was
    // EXPLICITLY attested. Signing a month is not examining a vendor, and in the
    // historical data the two are indistinguishable.
    //
    // Applied HERE and not in `vendorTier.js` on purpose: Q1 governs LIVE graduation
    // and Amendment B §3 leaves it untouched. Putting this bar in the state machine
    // would silently raise the live rule too, and the asymmetry is deliberate — live
    // records the distinction as it happens, history cannot.
    //
    // ONLY THE TIER IS WITHHELD (§5). observation_count, distinct_months, the amount
    // band and first/last-seen are all still seeded; the vendor simply starts STRANGER
    // and re-earns KNOWN over two live months.
    //
    // ON TODAY'S DATA THIS WITHHOLDS EVERYTHING — zero of 63 observations can be marked
    // explicit, because `exception_resolved` is null throughout and a recode leaves no
    // marker (O108). The amendment says so in its own §0; the planner reports it below
    // rather than letting a run of STRANGERs look like a judgement it did not make.
    const explicitCount = (state.observations || []).filter((o) => o.strength === ATTESTATION_STRENGTH.EXPLICIT).length;
    if (state.tier === VENDOR_TIER.KNOWN && explicitCount === 0) {
      state = { ...state, tier: VENDOR_TIER.STRANGER, tier_withheld: "no_explicit_attestation" };
    }
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
  // Identity provenance, in the report shape rather than a footnote.
  const allObs = [...byEntity.values()].flatMap((g) => g.observations);
  const identityMix = {
    resolved: allObs.filter((o) => o.identity_source === IDENTITY_STRATEGY.RESOLVE).length,
    read: allObs.filter((o) => o.identity_source === IDENTITY_STRATEGY.READ).length,
  };
  // Amendment B's effect, in the report shape. `withheld` counts vendors that met every
  // Q1 condition and were held back ONLY for want of an explicit attestation — so a
  // preview of nothing-but-STRANGERs can never be mistaken for a data problem, or for
  // a judgement about those vendors.
  const attestationMix = {
    explicit: allObs.filter((o) => o.strength === ATTESTATION_STRENGTH.EXPLICIT).length,
    implicit: allObs.filter((o) => o.strength === ATTESTATION_STRENGTH.IMPLICIT).length,
  };
  const withheldByAmendmentB = states.filter(({ state }) => state.tier_withheld === "no_explicit_attestation").length;
  const exercised = variance.filter((v) => v.distinctRawDescriptors > 1).length;

  return {
    rows: states.map(({ state }) => vendorStateRow(state, { companyId })),
    states,
    skipped,
    identityMix,
    attestationMix,
    withheldByAmendmentB,
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
  // Amendment B first: a vendor held back for want of an explicit attestation met every
  // other condition, and saying "only 2 observations" about it would be false.
  if (state.tier_withheld === "no_explicit_attestation") {
    return "met every Q1 condition; tier withheld — no observation was explicitly attested (Amendment B)";
  }
  const obs = state.observations || [];
  const months = new Set(obs.map((o) => o.month));
  const accounts = new Set(obs.map((o) => String(o.account_id)));
  if (obs.length < 2) return `only ${obs.length} attested observation${obs.length === 1 ? "" : "s"} in signed months`;
  if (months.size < 2) return `all ${obs.length} observations fall in ${[...months][0]}`;
  if (accounts.size > 1) return `attested to ${accounts.size} different accounts`;
  if (state.demotion_reason) return `decayed on arrival (${state.demotion_reason})`;
  if (state.tier_withheld === "no_explicit_attestation") {
    return "met every Q1 condition; tier withheld — no observation was explicitly attested (Amendment B)";
  }
  return "unknown";
}
