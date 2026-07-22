// ─────────────────────────────────────────────────────────────────────────────
// PERIOD SIGN-OFF persistence (O50 / O59 / O83). VERIFIED writes (select the row
// back so a policy/RLS failure can't read as success — the false-success class this
// whole trust layer exists to prevent). Table: period_signoffs (migrations 050/051).
//
// O83 hardening:
//   • attestation is a REVIEWER action (admin/accountant), never the client-owner;
//   • the pre-flight override is RECORDED on the row (override_ack/reason + the
//     blockers snapshot), so a sign-off over unresolved items is auditable;
//   • reopening is a SOFT revoke (revoked_at/revoked_by) — the row and its history
//     survive; re-signing the same period clears the revocation.
// ─────────────────────────────────────────────────────────────────────────────

const SIGNOFF_COLS = "id, period, signed_by, signed_at, note, override_ack, override_reason, blockers_snapshot, revoked_at, revoked_by";

// Sign off a period "reviewed through <period>" (YYYY-MM). Upsert so re-signing a
// period after a fix updates who/when AND clears any prior revocation. When the
// reviewer signed off over open blockers, `override` records the acknowledgment +
// reason + the exact blockers overridden. Returns { ok, row?, error? } — ok ONLY
// when the row is read back (the write actually committed).
export async function persistSignoff(supabase, { companyId, period, signedBy, note = null, override = null }) {
  if (!supabase || !companyId || !period || !signedBy) {
    return { ok: false, error: "missing companyId / period / signedBy" };
  }
  try {
    const row = {
      company_id: companyId, period, signed_by: signedBy, signed_at: new Date().toISOString(), note,
      // Override acknowledgment (null when the period was clean). Re-signing always
      // clears any prior revocation so a re-signed period is active again.
      override_ack: !!(override && override.acknowledged),
      override_reason: override && override.acknowledged ? (override.reason || null) : null,
      blockers_snapshot: override && override.acknowledged ? (override.blockers || null) : null,
      revoked_at: null, revoked_by: null,
    };
    const { data, error } = await supabase
      .from("period_signoffs")
      .upsert(row, { onConflict: "company_id,period" })
      .select(SIGNOFF_COLS)
      .single();
    if (error) return { ok: false, error: error.message || String(error) };
    if (!data) return { ok: false, error: "sign-off did not persist (no row returned)" };
    return { ok: true, row: data };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// Reopen a period — a SOFT revoke (keeps the row + its history for audit). Verified:
// reports the revoked row back. The active-signoffs read (fetchSignoffs) excludes
// revoked rows, so the "reviewed through" badge reverts immediately.
export async function revokeSignoff(supabase, { companyId, period, revokedBy = null }) {
  if (!supabase || !companyId || !period) return { ok: false, error: "missing companyId / period" };
  try {
    const { data, error } = await supabase
      .from("period_signoffs")
      .update({ revoked_at: new Date().toISOString(), revoked_by: revokedBy })
      .eq("company_id", companyId).eq("period", period).is("revoked_at", null)
      .select("id");
    if (error) return { ok: false, error: error.message || String(error) };
    return { ok: true, revoked: (data || []).length };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// All ACTIVE (non-revoked) sign-offs for a company, newest period first. Degrades
// gracefully if the table/columns don't exist yet (pre-migration) so the app keeps
// working. Revoked rows are excluded — they must not drive the "reviewed through" badge.
export async function fetchSignoffs(supabase, companyId) {
  if (!supabase || !companyId) return { ok: false, signoffs: [] };
  try {
    const { data, error } = await supabase
      .from("period_signoffs")
      .select(SIGNOFF_COLS)
      .eq("company_id", companyId)
      .is("revoked_at", null)
      .order("period", { ascending: false });
    if (error) return { ok: false, signoffs: [], error: error.message || String(error) };
    return { ok: true, signoffs: data || [] };
  } catch (e) {
    return { ok: false, signoffs: [], error: e?.message || String(e) };
  }
}

// Who may ATTEST (sign off / reopen) a period: the REVIEWER role = admin or accountant
// (the CPA/firm), which is exactly the DB's `is_company_reviewer` (migration 051). The
// plain OWNER (the client) may NOT self-attest their own books — the O83 separation-of-
// duties fix. A member cannot either. Pure — used by both the UI gate and the write guard.
export function canAttestPeriod(role) {
  return role === "admin" || role === "accountant";
}

// Does a SPECIFIC period already have an active (non-revoked) sign-off? Pure. The card
// keys its signed-vs-ready state on this per SELECTED month, so a month already attested
// never renders "ready to sign off" + the primary button simultaneously (O83 contradictory
// signed-and-ready fix). `signoffs` is normally the active set already, but we also skip any
// revoked row defensively.
export function isPeriodSignedOff(signoffs = [], period) {
  if (!period) return false;
  return (signoffs || []).some(s => s && !s.revoked_at && s.period === period);
}

// The latest "reviewed through" period, given the set of ACTIVE sign-offs. Pure.
// (Just the max period string — YYYY-MM sorts lexicographically = chronologically.
// Revoked rows are already excluded by fetchSignoffs; belt-and-suspenders here too.)
export function latestReviewedThrough(signoffs = []) {
  let max = null;
  for (const s of signoffs || []) {
    if (s && s.revoked_at) continue;
    const p = s && s.period;
    if (typeof p === "string" && /^\d{4}-\d{2}$/.test(p) && (max === null || p > max)) max = p;
  }
  return max;
}
