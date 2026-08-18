// ─────────────────────────────────────────────────────────────────────────────
// C201 — SHADOW MODE: the record shape and the scoring harness.
//
// Implements `docs/CALIBRATION_SPEC_O88_AMENDMENT_A.md`, signed 2026-08-16/17. Read
// that document before changing anything here; every threshold, exclusion and verdict
// below is quoting it, and this file has no authority to invent one.
//
// WHAT SHADOW MODE IS (§0): the ladder computes a verdict for every bank-sourced line
// ALONGSIDE the current confidence path, records both, and BOOKS NOTHING. This module
// is pure — no I/O, no Supabase, no writes. It cannot book by construction, which is
// the property that makes shadow mode safe to run against a live ledger.
//
// WHY THE HARNESS COMES BEFORE THE STATE MACHINE: the criterion was signed before any
// of it was built, deliberately (§ preamble). Building the scorer first means the
// state machine is written against a fixed definition of success rather than the
// other way round — the ·3a failure mode was a gate whose test was shaped to agree
// with it.
// ─────────────────────────────────────────────────────────────────────────────

// §3 verdict categories. PARK is a first-class outcome, not a soft failure.
export const SHADOW_VERDICT = {
  AGREE: "agree",         // ladder proposed the attested account
  PARK: "park",           // ladder proposed Uncategorized; attested account is real
  DISAGREE: "disagree",   // ladder proposed a DIFFERENT real account
  PHANTOM: "phantom",     // STRANGER yet proposed a real account — §4.1 automatic fail
};

// §5 outcomes.
export const SHADOW_OUTCOME = { PROCEED: "proceed", STOP: "stop", AMBIGUOUS: "ambiguous" };

// The sentinel a ladder returns when it declines to name an account. NOT an account id.
export const UNCATEGORIZED = "UNCATEGORIZED";

// §5 — fewer than this many scored lines is AMBIGUOUS, so a thin month cannot read as
// a pass. Quoted from the criterion; do not tune it here.
export const MIN_SCORED_LINES = 20;

const S = (v) => (v == null ? "" : String(v));

// ── §2 EXCLUSIONS ────────────────────────────────────────────────────────────
// Listed so they are visible rather than quiet. An excluded line is REPORTED, never
// silently dropped — a shrinking denominator nobody mentions is how a weak result
// becomes a strong-looking one.
export const EXCLUSION = {
  DELETED: "entry_deleted",              // parent JE soft-deleted (O108 finding B)
  RUNTIME_ACCOUNT: "runtime_account",    // attested account has system_role NULL (O108 C)
  NOT_BANK_SOURCED: "not_bank_sourced",  // transfers, payroll registers
  UNATTESTED: "unattested_month",        // no sign-off ⇒ no answer key (§1)
};

export function exclusionFor(line = {}) {
  if (line.entry_deleted) return EXCLUSION.DELETED;
  if (!line.month_attested) return EXCLUSION.UNATTESTED;
  if (!line.bank_sourced) return EXCLUSION.NOT_BANK_SOURCED;
  // The O108 accounts (3400/6520/6530 pre-068) — the answer key itself is questionable
  // there, so they are reported separately and NOT scored.
  if (line.attested_account_system_role == null) return EXCLUSION.RUNTIME_ACCOUNT;
  return null;
}

// ── §0 THE SHADOW RECORD ─────────────────────────────────────────────────────
// One per line. `proposed_account_id` is either a real account id or UNCATEGORIZED.
export function buildShadowRecord({
  line_id, descriptor, entity_key = null, matched_via = null, tier = null,
  proposed_account_id = UNCATEGORIZED, attested_account_id = null,
} = {}) {
  return {
    line_id: S(line_id), descriptor: S(descriptor),
    entity_key: entity_key == null ? null : S(entity_key),
    matched_via, tier,
    proposed_account_id: proposed_account_id === UNCATEGORIZED ? UNCATEGORIZED : S(proposed_account_id),
    attested_account_id: attested_account_id == null ? null : S(attested_account_id),
    verdict: null,
  };
}

// ── §3 SCORING, one record ───────────────────────────────────────────────────
// PHANTOM is checked FIRST and independently of agreement: a STRANGER that names a
// real account is a structural violation even when the account it names happens to be
// the right one. "Right by luck" is the failure, not the accident of being correct —
// a ladder that guesses well is still a ladder that guesses.
export function scoreShadowRecord(rec = {}) {
  const proposed = rec.proposed_account_id;
  const attested = rec.attested_account_id;
  const parked = proposed === UNCATEGORIZED;
  if (S(rec.tier).toUpperCase() === "STRANGER" && !parked) return SHADOW_VERDICT.PHANTOM;
  if (parked) return SHADOW_VERDICT.PARK;
  return S(proposed) === S(attested) ? SHADOW_VERDICT.AGREE : SHADOW_VERDICT.DISAGREE;
}

// ── §4.1(2) MERGE DETECTION — candidates only, and the limit is stated ───────
// A MERGE is "two distinct attested vendors resolving to one entity_key". Nothing in
// the data says which descriptors are distinct VENDORS — that is a judgement. What is
// observable is the SIGNAL: one entity_key whose lines were attested to more than one
// account. That is necessary but not sufficient (one vendor legitimately split across
// two accounts produces it too), so these are CANDIDATES requiring adjudication.
//
// ★ STATED PLAINLY: the criterion makes any real MERGE an automatic fail, and this
// harness cannot tell a real merge from a legitimate split on its own. It surfaces the
// candidate; a human decides. A harness that auto-failed on this signal would block on
// false positives, and one that ignored it would miss the one-way door. Neither is
// acceptable, so the ambiguity is surfaced rather than resolved by fiat.
export function detectMergeCandidates(records = []) {
  const byEntity = new Map();
  for (const r of records || []) {
    if (!r || !r.entity_key || !r.attested_account_id) continue;
    if (!byEntity.has(r.entity_key)) byEntity.set(r.entity_key, { entity_key: r.entity_key, accounts: new Set(), descriptors: new Set() });
    const g = byEntity.get(r.entity_key);
    g.accounts.add(S(r.attested_account_id));
    g.descriptors.add(S(r.descriptor));
  }
  return [...byEntity.values()]
    .filter((g) => g.accounts.size > 1)
    .map((g) => ({ entity_key: g.entity_key, attested_accounts: [...g.accounts], descriptors: [...g.descriptors] }));
}

// ── §4.1(3) RUN-TO-RUN VARIANCE ──────────────────────────────────────────────
// KNOWN is a persistent state (Q3), not a recomputation. A verdict that moves between
// runs on identical input means the state machine is not one.
export function compareRuns(runA = [], runB = []) {
  const a = new Map((runA || []).map((r) => [r.line_id, r]));
  const drifted = [];
  for (const r of runB || []) {
    const prior = a.get(r.line_id);
    if (!prior) continue;
    if (prior.verdict !== r.verdict || S(prior.proposed_account_id) !== S(r.proposed_account_id) || S(prior.tier) !== S(r.tier)) {
      drifted.push({ line_id: r.line_id, from: { tier: prior.tier, proposed: prior.proposed_account_id, verdict: prior.verdict },
                     to: { tier: r.tier, proposed: r.proposed_account_id, verdict: r.verdict } });
    }
  }
  return drifted;
}

// ── §5 THE REPORT ────────────────────────────────────────────────────────────
// `lines` are raw candidates; exclusions are applied here so the denominator is
// derived, never asserted. `months` is the set of ATTESTED months in scope.
export function shadowReport({ lines = [], months = [], priorRun = null } = {}) {
  const excluded = [];
  const records = [];
  for (const line of lines || []) {
    const why = exclusionFor(line);
    if (why) { excluded.push({ line_id: S(line.line_id), reason: why }); continue; }
    const rec = buildShadowRecord(line);
    rec.verdict = scoreShadowRecord(rec);
    records.push(rec);
  }

  const counts = { agree: 0, park: 0, disagree: 0, phantom: 0 };
  for (const r of records) counts[r.verdict] += 1;

  // §4.2 — every KNOWN-vendor disagreement, itemised individually. Not aggregated.
  const disagreements = records
    .filter((r) => r.verdict === SHADOW_VERDICT.DISAGREE)
    .map((r) => ({ line_id: r.line_id, descriptor: r.descriptor, entity_key: r.entity_key, tier: r.tier,
                   proposed_account_id: r.proposed_account_id, attested_account_id: r.attested_account_id,
                   resolution: null }));   // null until a human sets 'ladder_wrong'|'attestation_wrong'|'ambiguous'

  const phantoms = records.filter((r) => r.verdict === SHADOW_VERDICT.PHANTOM);
  const mergeCandidates = detectMergeCandidates(records);
  const drift = priorRun ? compareRuns(priorRun, records) : [];
  const attestedMonths = [...new Set((months || []).map(S).filter(Boolean))];

  // §5 — reasons are accumulated as sentences so the outcome always explains itself.
  const stop = [], blocking = [];
  if (phantoms.length) stop.push(`${phantoms.length} line${phantoms.length === 1 ? "" : "s"} classified STRANGER proposed a real account`);
  if (drift.length) stop.push(`${drift.length} line${drift.length === 1 ? "" : "s"} changed verdict between runs on identical input`);
  if (mergeCandidates.length) blocking.push(`${mergeCandidates.length} entity key${mergeCandidates.length === 1 ? "" : "s"} carried lines attested to more than one account — each needs adjudication`);
  if (disagreements.length) blocking.push(`${disagreements.length} disagreement${disagreements.length === 1 ? "" : "s"} are unresolved`);
  if (attestedMonths.length < 2) blocking.push(`shadow mode covered ${attestedMonths.length} attested month${attestedMonths.length === 1 ? "" : "s"}; the criterion asks for at least two`);

  let outcome;
  if (stop.length) outcome = SHADOW_OUTCOME.STOP;
  else if (records.length < MIN_SCORED_LINES) outcome = SHADOW_OUTCOME.AMBIGUOUS;
  else if (blocking.length) outcome = SHADOW_OUTCOME.AMBIGUOUS;
  else outcome = SHADOW_OUTCOME.PROCEED;

  return {
    records, counts, excluded, disagreements, phantoms, mergeCandidates, drift,
    attestedMonths, scored: records.length, outcome,
    reasons: outcome === SHADOW_OUTCOME.STOP ? stop
      : outcome === SHADOW_OUTCOME.AMBIGUOUS
        ? (records.length < MIN_SCORED_LINES
            ? [`only ${records.length} lines were scored; fewer than ${MIN_SCORED_LINES} cannot be read as a pass`, ...blocking]
            : blocking)
        : [],
  };
}

// ── §6 COPY — QUERY-CLAIMS ONLY ──────────────────────────────────────────────
// Every sentence reports what was MEASURED. No rate, no percentage, no adjective
// about the ladder. §1a: 40-60 lines cannot support a rate claim, so this function
// will not produce one — the numerator and denominator are always both printed.
export function shadowReportCopy(report = {}) {
  const c = report.counts || { agree: 0, park: 0, disagree: 0, phantom: 0 };
  const n = report.scored || 0;
  const out = [
    `The ladder proposed the attested account on ${c.agree} of ${n} scored line${n === 1 ? "" : "s"}.`,
    `${c.park} line${c.park === 1 ? "" : "s"} parked in Uncategorized — no attested mapping existed for those vendors.`,
    c.phantom === 0
      ? "No line classified STRANGER proposed a real account."
      : `${c.phantom} line${c.phantom === 1 ? "" : "s"} classified STRANGER proposed a real account.`,
    `${(report.disagreements || []).length} line${(report.disagreements || []).length === 1 ? "" : "s"} proposed a different account than the one attested.`,
  ];
  const ex = report.excluded || [];
  if (ex.length) {
    const by = {};
    for (const e of ex) by[e.reason] = (by[e.reason] || 0) + 1;
    out.push(`${ex.length} line${ex.length === 1 ? " was" : "s were"} not scored (${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(", ")}).`);
  }
  if ((report.mergeCandidates || []).length) {
    out.push(`${report.mergeCandidates.length} entity key${report.mergeCandidates.length === 1 ? "" : "s"} carried lines attested to more than one account.`);
  }
  out.push(`Months covered: ${(report.attestedMonths || []).join(", ") || "none"}.`);
  return out;
}
