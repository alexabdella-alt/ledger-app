// ─────────────────────────────────────────────────────────────────────────────
// Chat-action persistence + verification (O78 / O51).
//
// Every AI-chatbot mutation that reports success MUST durably write to the DB and
// be VERIFIED (re-read), never just reflected in local React state — otherwise the
// reply says "done" while the change vanishes on refresh (the false-success bug).
//
// These helpers take an injected `db` (the Supabase client, or a fake in tests) so
// the write-then-verify contract is unit-testable. Each returns { ok, error, row? }.
// `ok` is true ONLY when a read-back confirms the row committed — so a silent
// RLS / NOT-NULL / constraint failure can never be reported as success.
// ─────────────────────────────────────────────────────────────────────────────

export const RECURRING_FREQUENCIES = ["weekly", "monthly", "quarterly", "annual"];

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ── Pure DB-row builders (shape only; FK ids resolved by the caller) ──────────
// vendor_rules: company_id, contact_id NOT NULL, account_id NOT NULL, project, active.
export function buildVendorRuleRow({ companyId, contactId, accountId, project = null }) {
  return { company_id: companyId, contact_id: contactId, account_id: accountId, project: project || null, active: true };
}
// recurring_transactions: name NOT NULL, amount NOT NULL, debit/credit account NOT NULL,
// frequency CHECK ∈ RECURRING_FREQUENCIES, next_date NOT NULL.
export function buildRecurringRow({ companyId, name, contactId = null, amount, debitAccountId, creditAccountId, frequency, nextDate, project = null }) {
  return {
    company_id: companyId,
    name: name || "Recurring",
    contact_id: contactId || null,
    amount: r2(amount),
    debit_account_id: debitAccountId,
    credit_account_id: creditAccountId,
    project: project || null,
    frequency: RECURRING_FREQUENCIES.includes(frequency) ? frequency : "monthly",
    next_date: nextDate,
    active: true,
  };
}

// ── Generic write-then-verify primitives (the honest-on-failure core) ─────────
// Insert a row, then re-READ it by id to confirm it committed. ok requires the read-back.
export async function insertVerified(db, table, payload) {
  if (!db) return { ok: false, error: "no db client" };
  try {
    const ins = await db.from(table).insert(payload).select().single();
    if (ins.error || !ins.data || ins.data.id == null) {
      return { ok: false, error: ins.error?.message || "insert returned no row" };
    }
    const chk = await db.from(table).select("*").eq("id", ins.data.id).maybeSingle();
    if (chk.error || !chk.data) return { ok: false, error: chk.error?.message || "row missing after insert" };
    return { ok: true, row: chk.data };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

// Patch a row by id; the post-update returned row IS the committed DB truth. ok requires
// that every patched field actually matches in the returned row (caught a no-op update).
export async function updateVerified(db, table, id, patch) {
  if (!db || id == null) return { ok: false, error: "no db client / id" };
  try {
    const upd = await db.from(table).update(patch).eq("id", id).select().single();
    if (upd.error || !upd.data) return { ok: false, error: upd.error?.message || "update returned no row" };
    for (const k of Object.keys(patch)) {
      if (upd.data[k] !== patch[k]) return { ok: false, error: `field "${k}" did not persist` };
    }
    return { ok: true, row: upd.data };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

// Delete rows matching `match` ({col: val}), then verify none remain. Used for scoped
// chat deletes (O51) of rows that aren't soft-delete-tracked (e.g. vendor_rules).
export async function deleteVerified(db, table, match) {
  if (!db || !match || !Object.keys(match).length) return { ok: false, error: "no db client / match" };
  try {
    let q = db.from(table).delete();
    for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
    const del = await q;
    if (del.error) return { ok: false, error: del.error.message };
    let s = db.from(table).select("id");
    for (const [k, v] of Object.entries(match)) s = s.eq(k, v);
    const chk = await s;
    if (chk.error) return { ok: false, error: chk.error.message };
    if (Array.isArray(chk.data) && chk.data.length > 0) return { ok: false, error: "rows still present after delete" };
    return { ok: true, deleted: true };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}
