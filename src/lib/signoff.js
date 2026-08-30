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

const SIGNOFF_COLS = "id, period, signed_by, signed_at, note, override_ack, override_reason, blockers_snapshot, revoked_at, revoked_by, self_attested";

// Sign off a period "reviewed through <period>" (YYYY-MM). Upsert so re-signing a
// period after a fix updates who/when AND clears any prior revocation. When the
// reviewer signed off over open blockers, `override` records the acknowledgment +
// reason + the exact blockers overridden. Returns { ok, row?, error? } — ok ONLY
// when the row is read back (the write actually committed).
export async function persistSignoff(supabase, { companyId, period, signedBy, note = null, override = null, selfAttested = false }) {
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
      // ★ O131 — WHICH KIND OF ATTESTATION THIS WAS. Migration `085`'s policy decides which
      // path the row is allowed through, so this cannot be a client's opinion: a row marked
      // true is only accepted from a solo owner, and one marked false only from a reviewer.
      // Sending the wrong value gets the write REFUSED rather than silently misrecorded.
      self_attested: !!selfAttested,
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

// ─────────────────────────────────────────────────────────────────────────────
// ★★ O131 — DOES ANYONE ON THIS COMPANY HOLD THE ROLE AT ALL?
//
// An OWNER deliberately cannot attest: separating who keeps the books from who signs them
// off is the point of the product when an accountant is involved, and the database enforces
// it. **But one person holds one role, so a solo signup has nobody who can ever sign.** Their
// home screen said *"Awaiting your accountant's sign-off"* — about an accountant who does not
// exist — and would have said it forever, with nothing explaining why.
//
// ★ WHETHER a solo owner should be ABLE to attest is a product decision and is NOT decided
// here. This only answers the factual question the copy needs either way: **is there anybody
// who could?** Under every option on the table, promising a review that cannot arrive is
// wrong — so this is safe to fix before the decision, and it forecloses none of it.
//
// `members` is the `company_users` shape: `{ role, accepted_at }`. An UNACCEPTED invite does
// not count — an invitation is not a person, and counting it would put the promise back with
// an extra step.
// ─────────────────────────────────────────────────────────────────────────────
// ★★ THE SOLO EXCEPTION, AND IT IS DELIBERATELY NOT `canAttestPeriod`.
//
// Operator's decision, 2026-08-30: a solo owner may sign with an acknowledgement. But
// `canAttestPeriod` also drives the SEAT (`nav.js isReviewerSeat`), so widening it would drop
// a client into the CPA cockpit — ten workbench tabs the North Star exists to keep them out
// of. **They get the sign-off ACTION, not the reviewer's seat**, so this is its own predicate
// and a test pins that `canAttestPeriod('owner')` stays false.
//
// ★ AND IT IS CONDITIONAL, NOT A LOOSENING. The moment a real accountant joins, this returns
// false again and the separation — the whole point of the product — is back. `053` met the
// same case by PROMOTING the owner to admin, which was permanent and could not be undone
// once `081` blocked self-role-changes; evaluating the condition each time is strictly
// better than changing who somebody is.
export function canSelfAttest({ role = null, hasAttester = true } = {}) {
  return role === "owner" && !hasAttester;
}

// The sentence a person ticks. Plain language, and it states the two things that are
// actually true and non-obvious: nobody else has checked, and the month locks.
//
// ★ THE LOCK CLAUSE IS NOT BOILERPLATE — migration `078` makes the database refuse changes
// to a signed month. Someone who signs without knowing that discovers it when a correction
// is rejected, which is the worst possible moment to learn it.
export function selfAttestAcknowledgement(monthLabelText) {
  const when = monthLabelText ? ` for ${monthLabelText}` : "";
  return `I'm signing off these books${when} myself. No accountant has checked them, and once signed the figures can't be changed unless I reopen the month.`;
}

export function companyHasAttester(members = []) {
  return (members || []).some((m) => m && m.accepted_at && canAttestPeriod(m.role));
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
