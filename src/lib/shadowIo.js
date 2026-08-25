// ─────────────────────────────────────────────────────────────────────────────
// C201 — THE SHADOW I/O SHELL. Deliberately thin.
//
// Reads what `planShadowRun` needs, calls it, writes the rows it returns. That is the
// whole job. All judgement lives in the pure modules; this file must never acquire
// any, because it is the only part of shadow mode that can touch the database.
//
// ★★ ITS ENTIRE WRITE SURFACE IS ONE INSERT INTO ONE TABLE.
// `calibration_shadow_records` is a table the ledger never reads. A test asserts that
// every `.insert(` / `.update(` / `.delete(` in this file targets that table and no
// other — so "shadow mode books nothing" (Amendment A §0) is checkable by reading the
// file rather than by trusting it. `shadowRun.js` proves it cannot decide to book;
// this proves it has nowhere to book to.
//
// The client is INJECTED, never imported. That is what keeps the guard meaningful: a
// module that reaches for its own client can widen its own surface later.
// ─────────────────────────────────────────────────────────────────────────────

import { planShadowRun } from "./shadowRun.js";

const SHADOW_TABLE = "calibration_shadow_records";
const CHUNK = 200;

// The columns `072` defines. Listed explicitly so a stray field from the planner
// (`propose_basis`, which is report-only) cannot be posted at a column that does not
// exist — PostgREST would reject the whole batch and the run would look like a failure
// of shadow mode rather than of the writer.
const ROW_COLUMNS = [
  "company_id", "run_id", "journal_entry_line_id", "period",
  "descriptor_display", "resolver_input", "entity_key", "identity_source",
  "matched_via", "tier", "proposed_account_id", "attested_account_id",
  "verdict", "excluded_reason",
];
const toRow = (r) => Object.fromEntries(ROW_COLUMNS.map((c) => [c, r[c] ?? null]));

// ── READ ─────────────────────────────────────────────────────────────────────
// Everything the ladder needs, in one place, so the planner stays pure and the query
// shapes are visible rather than scattered.
export async function readShadowInputs({ supabase, companyId, from, to }) {
  const [signoffs, accounts, states, directory, lines] = await Promise.all([
    supabase.from("period_signoffs").select("period").eq("company_id", companyId),
    supabase.from("accounts").select("id, code, system_role").eq("company_id", companyId),
    supabase.from("vendor_state").select("entity_key, tier, attested_account_id").eq("company_id", companyId),
    supabase.from("universal_vendor_directory").select("*").eq("active", true),
    supabase.from("journal_entry_lines")
      .select("id, account_id, debit, credit, journal_entries!inner(id, entry_date, description, source, deleted_at, company_id)")
      .eq("company_id", companyId)
      .gte("journal_entries.entry_date", from)
      .lte("journal_entries.entry_date", to),
  ]);

  const err = [signoffs, accounts, states, directory, lines].find((r) => r && r.error);
  if (err) throw new Error(`[shadow] read failed: ${err.error.message}`);

  const accountRoleById = {}, companyAccountsByRole = {};
  for (const a of accounts.data || []) {
    accountRoleById[String(a.id)] = a.system_role ?? null;
    if (a.system_role) companyAccountsByRole[a.system_role] = String(a.id);
  }
  const vendorStates = {};
  for (const s of states.data || []) vendorStates[s.entity_key] = s;

  return {
    signedMonths: (signoffs.data || []).map((s) => s.period),
    accountRoleById, companyAccountsByRole, vendorStates,
    directory: (directory.data || []).map((d) => ({ ...d, entity_key: d.entity_key })),
    lines: (lines.data || []).map((l) => ({
      line_id: l.id,
      account_id: l.account_id,
      amount: Number(l.debit || l.credit || 0),
      date: l.journal_entries?.entry_date,
      descriptor: l.journal_entries?.description,
      source: l.journal_entries?.source,
      deleted: !!l.journal_entries?.deleted_at,
      // Every source the ladder scores is bank-sourced by definition; the per-source
      // strategy excludes the rest by name, so this stays true rather than assumed.
      bank_sourced: l.journal_entries?.source === "bank_import",
    })),
  };
}

// ── RUN ──────────────────────────────────────────────────────────────────────
// Read → plan → write. `runId` is supplied by the caller (no clock, no randomness in
// here) so a run is reproducible and `072`'s unique (run_id, line_id) index means a
// re-run with the same id is refused rather than silently duplicated.
export async function runShadowPass({ supabase, companyId, runId, from, to, dryRun = false }) {
  const inputs = await readShadowInputs({ supabase, companyId, from, to });
  const plan = planShadowRun({ ...inputs, companyId, runId });

  if (dryRun) return { ...plan, written: 0, dryRun: true };

  let written = 0;
  for (let i = 0; i < plan.rows.length; i += CHUNK) {
    const batch = plan.rows.slice(i, i + CHUNK).map(toRow);
    const { data, error } = await supabase.from(SHADOW_TABLE).insert(batch).select("id");
    // A partial write makes the denominator wrong, and a wrong denominator is how a
    // weak result reads as a strong one (Amendment A §2). Fail loudly and stop.
    if (error) throw new Error(`[shadow] write failed at row ${i}: ${error.message}`);
    written += (data || []).length;
  }
  if (written !== plan.rows.length) {
    throw new Error(`[shadow] wrote ${written} of ${plan.rows.length} rows — the run is incomplete and must not be scored`);
  }
  return { ...plan, written };
}
