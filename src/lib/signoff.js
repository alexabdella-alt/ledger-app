// ─────────────────────────────────────────────────────────────────────────────
// PERIOD SIGN-OFF persistence (O50 / O59). VERIFIED writes (select the row back
// so a policy/RLS failure can't read as success — the false-success class this
// whole trust layer exists to prevent). Table: period_signoffs (migration 050).
// ─────────────────────────────────────────────────────────────────────────────

// Sign off a period "reviewed through <period>" (YYYY-MM). Upsert so re-signing a
// period after a fix updates who/when. Returns { ok, row?, error? } — ok ONLY when
// the row is read back (the write actually committed).
export async function persistSignoff(supabase, { companyId, period, signedBy, note = null }) {
  if (!supabase || !companyId || !period || !signedBy) {
    return { ok: false, error: "missing companyId / period / signedBy" };
  }
  try {
    const { data, error } = await supabase
      .from("period_signoffs")
      .upsert(
        { company_id: companyId, period, signed_by: signedBy, signed_at: new Date().toISOString(), note },
        { onConflict: "company_id,period" }
      )
      .select("id, period, signed_by, signed_at, note")
      .single();
    if (error) return { ok: false, error: error.message || String(error) };
    if (!data) return { ok: false, error: "sign-off did not persist (no row returned)" };
    return { ok: true, row: data };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// Remove a period's sign-off (reopen it). Verified: reports rows deleted.
export async function removeSignoff(supabase, { companyId, period }) {
  if (!supabase || !companyId || !period) return { ok: false, error: "missing companyId / period" };
  try {
    const { data, error } = await supabase
      .from("period_signoffs")
      .delete()
      .eq("company_id", companyId).eq("period", period)
      .select("id");
    if (error) return { ok: false, error: error.message || String(error) };
    return { ok: true, removed: (data || []).length };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// All sign-offs for a company, newest period first. Degrades gracefully if the
// table doesn't exist yet (pre-migration) so the app keeps working.
export async function fetchSignoffs(supabase, companyId) {
  if (!supabase || !companyId) return { ok: false, signoffs: [] };
  try {
    const { data, error } = await supabase
      .from("period_signoffs")
      .select("id, period, signed_by, signed_at, note")
      .eq("company_id", companyId)
      .order("period", { ascending: false });
    if (error) return { ok: false, signoffs: [], error: error.message || String(error) };
    return { ok: true, signoffs: data || [] };
  } catch (e) {
    return { ok: false, signoffs: [], error: e?.message || String(e) };
  }
}

// Who may ATTEST (sign off / reopen) a period: the reviewer role = owner or admin, which is
// exactly the DB's `is_company_admin` (migration 050's period_signoffs insert/delete policy).
// A plain member cannot. Pure — used by both the UI gate and the client write guard.
export function canAttestPeriod(role) {
  return role === "owner" || role === "admin";
}

// The latest CONTIGUOUS "reviewed through" period, given the set of sign-offs. Pure.
// (Just the max period string — YYYY-MM sorts lexicographically = chronologically.)
export function latestReviewedThrough(signoffs = []) {
  let max = null;
  for (const s of signoffs || []) {
    const p = s && s.period;
    if (typeof p === "string" && /^\d{4}-\d{2}$/.test(p) && (max === null || p > max)) max = p;
  }
  return max;
}
