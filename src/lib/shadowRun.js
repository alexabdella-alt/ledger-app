// ─────────────────────────────────────────────────────────────────────────────
// C201 — THE SHADOW EXECUTOR (planning half).
//
// Runs the ladder over historical lines: identity → tier → proposed account → verdict,
// and produces rows for `calibration_shadow_records` (migration `072`). Implements
// `docs/CALIBRATION_SPEC_O88_AMENDMENT_A.md` (signed) and quotes it rather than
// inventing thresholds.
//
// ★★ IT CANNOT BOOK, AND THAT IS A PROPERTY OF THIS FILE, NOT A PROMISE ABOUT IT.
// This module performs NO I/O. It imports only the four pure calibration modules; it
// has no Supabase client, no fetch, no `persist*`, no `logAudit`. It takes data that
// has already been read and returns rows to be written. The caller does the reading
// and the writing, and its entire write surface is one INSERT into one table that the
// ledger does not consult.
//
// A test asserts the import list and the absence of every booking primitive by name.
// Amendment A §0 requires shadow mode to book nothing; "we were careful" is not a
// mechanism, so the mechanism is that the booking vocabulary is not reachable from
// here. The same argument `calibrationShadow.js` makes by having no imports at all.
//
// WHY A SEPARATE MODULE FROM `calibrationShadow.js`: that one SCORES a record against
// the answer key. This one PRODUCES the record — resolving who the vendor is and what
// the ladder would propose. Keeping them apart means the scorer cannot quietly become
// the thing it scores.
// ─────────────────────────────────────────────────────────────────────────────

import { identityForEntry, IDENTITY_STRATEGY, resolveVendorIdentity, MATCH_SOURCE } from "./vendorIdentity.js";
import { matchDirectory } from "./vendorDirectory.js";
import { VENDOR_TIER, resolveTier } from "./vendorTier.js";
import { scoreShadowRecord, exclusionFor, UNCATEGORIZED, EXCLUSION } from "./calibrationShadow.js";
import { isPayrollBankLine } from "./payroll.js";

const monthOf = (d) => String(d || "").slice(0, 7);

// ── PROPOSING AN ACCOUNT ─────────────────────────────────────────────────────
// What the ladder would book to, per tier. Rule 2: the mapping comes from KNOWLEDGE —
// this company's attested history, the census, or the curated directory — never from
// plausibility. Where knowledge is empty the answer is UNCATEGORIZED, which is an
// honest suspense and not a failure.
//
// ★ THE DIRECTORY RESOLVES A ROLE, AND THE ROLE MUST EXIST IN *THIS COMPANY'S* CHART.
// If it does not, the ladder PARKS — it does NOT fall through to the built-in chart.
// That fallback (`useAccounts` DEFAULT_BY_ROLE, O108 finding 4) returns a plausible
// account object for a role the company lacks, and `ensureAccount` then MATERIALISES
// it. A shadow run that reached that path would create accounts on eleven companies
// while claiming to book nothing.
export function proposeAccount({ tier, state = null, directoryHit = null, companyAccountsByRole = {} } = {}) {
  if (tier === VENDOR_TIER.KNOWN || tier === VENDOR_TIER.DECLARED) {
    const id = state && state.attested_account_id;
    return id ? { proposed_account_id: String(id), basis: "attested" }
              : { proposed_account_id: null, basis: "no_attested_mapping" };
  }
  if (tier === VENDOR_TIER.UNIVERSAL) {
    const role = directoryHit && directoryHit.default_account_role;
    const acct = role ? companyAccountsByRole[role] : null;
    return acct ? { proposed_account_id: String(acct), basis: "directory_default" }
                : { proposed_account_id: null, basis: role ? "directory_role_absent_from_chart" : "no_directory_mapping" };
  }
  // STRANGER — Rule 2. Never a guessed account, at any amount, at any legibility.
  return { proposed_account_id: null, basis: "stranger" };
}

// ── ONE LINE ─────────────────────────────────────────────────────────────────
// Returns a `calibration_shadow_records` row. Either SCORED (verdict, no
// excluded_reason) or EXCLUDED (reason, no verdict) — the XOR the schema enforces.
export function shadowRecordForLine(line = {}, ctx = {}) {
  const {
    companyId = null, runId = null, vendorStates = {}, directory = [],
    aliases = [], knownKeys = [], companyAccountsByRole = {}, accountRoleById = {},
  } = ctx;

  const base = {
    company_id: companyId, run_id: runId,
    journal_entry_line_id: line.line_id ?? null,
    period: monthOf(line.date),
    descriptor_display: line.descriptor ?? null,
    resolver_input: null,
    entity_key: null, identity_source: null, matched_via: null, tier: null,
    proposed_account_id: null, attested_account_id: line.account_id ?? null,
    verdict: null, excluded_reason: null,
  };

  // §2 exclusions first — reported, never dropped.
  const why = exclusionFor({
    entry_deleted: line.deleted,
    month_attested: line.month_attested,
    bank_sourced: line.bank_sourced,
    attested_account_system_role: accountRoleById[String(line.account_id)] ?? null,
  });
  if (why) return { ...base, excluded_reason: why };

  // Payroll on either rail carries no vendor→account judgement to learn.
  if (isPayrollBankLine({ vendor: line.vendor, description: line.descriptor })) {
    return { ...base, excluded_reason: "payroll_bank_line" };
  }

  // Identity, per source.
  const ident = identityForEntry({ description: line.descriptor, source: line.source });
  if (ident.excluded) return { ...base, excluded_reason: ident.excluded };

  // `resolver_input` is what the resolver ACTUALLY SAW — the raw half for bank lines,
  // the vendor field for READ sources. Stored beside the display string so a
  // disagreement can be traced to the resolver or to what it was handed.
  const resolverInput = ident.raw;
  const identity_source = ident.identity_source;

  // For RESOLVE, re-run the full resolution so `matched_via` records HOW we knew —
  // alias (a human said so) beats a held key beats the curated directory. For READ,
  // the vendor came from a field and there is nothing to resolve.
  let matched_via = MATCH_SOURCE.NORMALIZED;
  let directoryHit = null;
  if (identity_source === IDENTITY_STRATEGY.RESOLVE) {
    const r = resolveVendorIdentity(resolverInput, { aliases, knownKeys, directory });
    matched_via = r.matchedVia;
    if (r.matchedVia === MATCH_SOURCE.DIRECTORY) directoryHit = matchDirectory(resolverInput, directory);
  }

  const entity_key = ident.entity_key;
  const state = vendorStates[entity_key] || null;
  if (!directoryHit) directoryHit = matchDirectory(resolverInput, directory);

  const tier = resolveTier({ state, inCensus: !!(state && state.in_census), inDirectory: !!directoryHit });
  const { proposed_account_id, basis } = proposeAccount({ tier, state, directoryHit, companyAccountsByRole });

  const scored = { ...base, resolver_input: resolverInput, entity_key, identity_source, matched_via, tier,
                   proposed_account_id, propose_basis: basis };
  scored.verdict = scoreShadowRecord({
    tier,
    proposed_account_id: proposed_account_id ?? UNCATEGORIZED,
    attested_account_id: scored.attested_account_id,
  });
  return scored;
}

// ── THE RUN ──────────────────────────────────────────────────────────────────
// `lines` are already-read rows. `signedMonths` decides which have an answer key.
// Returns rows plus the counts a report is built from — and NOTHING that could be
// mistaken for an instruction to write to the ledger.
export function planShadowRun({ lines = [], signedMonths = [], companyId = null, runId = null, ...ctx } = {}) {
  const signed = new Set((signedMonths || []).map(String));
  const rows = (lines || []).map((line) =>
    shadowRecordForLine(
      { ...line, month_attested: signed.has(monthOf(line.date)), bank_sourced: line.bank_sourced !== false },
      { ...ctx, companyId, runId },
    ),
  );

  const scored = rows.filter((r) => r.verdict);
  const excluded = rows.filter((r) => r.excluded_reason);
  const counts = { agree: 0, park: 0, disagree: 0, phantom: 0 };
  for (const r of scored) counts[r.verdict] += 1;
  const excludedBy = {};
  for (const r of excluded) excludedBy[r.excluded_reason] = (excludedBy[r.excluded_reason] || 0) + 1;
  const identityMix = {
    resolved: scored.filter((r) => r.identity_source === IDENTITY_STRATEGY.RESOLVE).length,
    read: scored.filter((r) => r.identity_source === IDENTITY_STRATEGY.READ).length,
  };
  const tierMix = {};
  for (const r of scored) tierMix[r.tier] = (tierMix[r.tier] || 0) + 1;
  // Why each park happened — a park rate without its reasons is a number nobody can act
  // on, and Amendment A §5 requires the report to say WHICH vendors parked and why.
  const parkBasis = {};
  for (const r of scored.filter((x) => x.verdict === "park")) {
    parkBasis[r.propose_basis] = (parkBasis[r.propose_basis] || 0) + 1;
  }

  return { rows, scored: scored.length, counts, excluded: excluded.length, excludedBy, identityMix, tierMix, parkBasis };
}
