// ─────────────────────────────────────────────────────────────────────────────
// C192 — CHECKED WRITES. The root-cause class behind two live O84 bugs.
//
// A PostgREST `.update()` that matches ZERO rows reports **no error** — it just
// succeeds having changed nothing. Pair that with an empty `catch {}` and a broken
// write becomes completely invisible:
//   • C191 — planner exceptions carried a non-DB id, so every `.eq("id", …)` matched
//     nothing; five lines silently stayed 'pending'.
//   • C189 — the payroll entry never got `payment_status`, and nothing said so until
//     an `ap_tie` control total failed by $4,306.
// Both would have been ONE loud console line under a checked write.
//
// The critical mechanic: you MUST call `.select()` on the update. Without
// `returning=representation` PostgREST does not tell you how many rows it touched —
// which is exactly why these failures were undetectable. `zero rows` IS a failure.
//
// Failures are LOGGED + COUNTED, never thrown: callers (the pipeline) already
// continue past individual line failures; this makes them visible, not fatal.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_RECORDS = 50;
let failureCount = 0;
let failureRecords = [];

// PURE core: did a row-targeted write actually take effect?
//   ok        — no error AND at least one row returned
//   db_error  — the driver reported an error
//   zero_rows — no error, but nothing matched (the silent-failure class)
export function assessWriteResult({ error = null, rows = null } = {}) {
  if (error) return { ok: false, reason: "db_error" };
  const n = Array.isArray(rows) ? rows.length : 0;
  if (n === 0) return { ok: false, reason: "zero_rows" };
  return { ok: true, reason: null };
}

// Record + loudly log a failed write. Returns the failure shape callers hand back.
function recordFailure({ label, table, id, reason, message = null }) {
  failureCount++;
  const rec = { label, table, id: id == null ? null : String(id), reason, message: message || null, at: new Date().toISOString() };
  failureRecords.push(rec);
  if (failureRecords.length > MAX_RECORDS) failureRecords = failureRecords.slice(-MAX_RECORDS);
  // LOUD by design — this is the signal that did not exist before C192.
  console.error(`[checked-write] ${label} failed (${reason}) ${table}#${rec.id}${message ? " — " + message : ""}`);
  return { ok: false, reason };
}

// The failure counter + the last N failure records (for the outcome line / audit event).
export function getWriteFailures() {
  return { count: failureCount, records: failureRecords.slice() };
}
export function resetWriteFailures() {
  failureCount = 0;
  failureRecords = [];
}

// A ROW-TARGETED update (exactly one id, scoped to the company). `.select("id")` is
// REQUIRED so PostgREST returns the affected rows — without it a zero-row update is
// indistinguishable from a successful one. NEVER throws.
export async function checkedRowUpdate({ supabase, table, id, companyId, patch, label = "write" } = {}) {
  if (!supabase || !table || id == null || !companyId) {
    return recordFailure({ label, table: table || "?", id, reason: "db_error", message: "missing supabase/table/id/companyId" });
  }
  try {
    const { data, error } = await supabase.from(table)
      .update(patch)
      .eq("id", String(id))
      .eq("company_id", companyId)
      .select("id");                                   // ← required: makes affected rows observable
    const verdict = assessWriteResult({ error, rows: data });
    if (!verdict.ok) return recordFailure({ label, table, id, reason: verdict.reason, message: error?.message || null });
    return { ok: true, reason: null };
  } catch (e) {
    return recordFailure({ label, table, id, reason: "db_error", message: e?.message || String(e) });
  }
}

// The BATCH sibling (`.in("id", ids)`) for set-targeted updates. Same observability
// requirement; also warns on a PARTIAL apply (fewer rows than ids) without counting it
// as a hard failure. NEVER throws.
export async function checkedIdsUpdate({ supabase, table, ids = [], companyId, patch, label = "write" } = {}) {
  const list = (ids || []).map(String).filter(Boolean);
  if (!supabase || !table || !companyId || !list.length) {
    return recordFailure({ label, table: table || "?", id: null, reason: "db_error", message: "missing supabase/table/ids/companyId" });
  }
  try {
    const { data, error } = await supabase.from(table)
      .update(patch)
      .in("id", list)
      .eq("company_id", companyId)
      .select("id");
    const verdict = assessWriteResult({ error, rows: data });
    if (!verdict.ok) return recordFailure({ label, table, id: list.join(","), reason: verdict.reason, message: error?.message || null });
    if (Array.isArray(data) && data.length < list.length) {
      console.warn(`[checked-write] ${label} partial ${table}: ${data.length}/${list.length} rows updated`);
    }
    return { ok: true, reason: null };
  } catch (e) {
    return recordFailure({ label, table, id: list.join(","), reason: "db_error", message: e?.message || String(e) });
  }
}

// PURE owner-facing sentence appended to the pipeline outcome when writes failed.
// Plain language (Cardinal Principle) — no table names, no ids, no GL jargon.
export function writeFailureSentence(count = 0) {
  const n = Number(count) || 0;
  if (n <= 0) return "";
  return ` — ${n} update${n === 1 ? "" : "s"} didn't save; your accountant should re-run this statement`;
}
