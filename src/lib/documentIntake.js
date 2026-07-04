// ─────────────────────────────────────────────────────────────────────────────
// Document Completeness Guarantee (O60) — the INDEPENDENT intake ledger.
//
// CORE PRINCIPLE: completeness can't be verified against the same pipeline that does
// the recording — a bug that drops a document also drops it from a self-referential
// check. So every document is logged to `document_intake` FIRST, on arrival, before any
// AI/parsing/booking. The pipeline only ANNOTATES the row's status; it never owns the
// population. `reconcileIntake` reads the intake population and flags anything that fell
// through — so it sees documents even when the processing pipeline lost them.
//
// These helpers take an injected `db` (Supabase client, or a fake in tests) so the
// write/verify contract and the reconciliation logic are unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

export const INTAKE_STATUS = {
  RECEIVED: "received",
  PROCESSING: "processing",
  RECORDED: "recorded",          // became journal entr(ies) — terminal, traceable
  HELD: "held_for_review",       // couldn't auto-process / ambiguous / handed to another queue — terminal, VISIBLE
  REJECTED: "rejected",          // explicitly not-a-transaction (dupe/junk/personal) — terminal
  FAILED: "failed",              // hard error — NON-terminal (must be surfaced, not lost)
};

// "Resolved" = these three. Everything else (received / processing / failed) means the doc
// has NOT reached a safe resting place and must be surfaced by the reconciliation.
export const TERMINAL_INTAKE_STATUSES = [INTAKE_STATUS.RECORDED, INTAKE_STATUS.HELD, INTAKE_STATUS.REJECTED];
export const isTerminalIntake = (s) => TERMINAL_INTAKE_STATUSES.includes(s);

// Pure arrival-row builder (no AI, no logic — this is the "essentially cannot fail" write).
export function buildIntakeRow({ companyId, filename = null, contentHash = null, source = "upload", uploadedBy = null, documentId = null }) {
  return {
    company_id: companyId,
    filename: filename || null,
    content_hash: contentHash || null,
    source: source || "upload",
    uploaded_by: uploadedBy || null,
    document_id: documentId || null,
    status: INTAKE_STATUS.RECEIVED,
  };
}

// ── THE COMPLETENESS CHECK (pure, independent of the recording pipeline) ──────
// Given intake rows, return those that "fell through":
//   • failed                  → always (errored mid-process)
//   • received / processing   → only once older than stuckMinutes, so genuinely in-flight
//                               uploads aren't false positives
// Reads ONLY the intake population — never the journal_entries / documents tables — which is
// exactly why it catches a doc the pipeline silently dropped (no JE, no doc row, but the
// intake row is still here, non-terminal).
export function reconcileIntake(rows = [], { now = new Date(), stuckMinutes = 30 } = {}) {
  const nowMs = +new Date(now);
  const dropped = [];
  for (const r of (rows || [])) {
    if (!r) continue;
    const status = r.status || INTAKE_STATUS.RECEIVED;
    if (isTerminalIntake(status)) continue;
    const ageMin = (nowMs - +new Date(r.received_at || r.created_at || now)) / 60000;
    let reason = null;
    if (status === INTAKE_STATUS.FAILED) reason = "processing failed";
    else if (status === INTAKE_STATUS.PROCESSING) { if (ageMin > stuckMinutes) reason = `stuck in processing (${Math.round(ageMin)}m)`; }
    else { if (ageMin > stuckMinutes) reason = `received but never recorded (${Math.round(ageMin)}m)`; }
    if (reason) dropped.push({ id: r.id, filename: r.filename, status, received_at: r.received_at, age_minutes: Math.round(ageMin), reason });
  }
  return dropped;
}

// ── DB write/verify primitives (verified — never report a write that didn't commit) ──
export async function insertIntake(db, row) {
  if (!db) return { ok: false, error: "no db client" };
  try {
    const ins = await db.from("document_intake").insert(row).select().single();
    if (ins.error || !ins.data || ins.data.id == null) return { ok: false, error: ins.error?.message || "intake insert returned no row" };
    return { ok: true, id: ins.data.id, row: ins.data };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

// Advance an intake row's status (+ optional JE link / detail), then confirm the status
// committed via the returned row. journal_entry_ids is an array, so we verify `status`
// (scalar) rather than deep-comparing the array.
export async function setIntakeStatus(db, id, status, { journalEntryIds = null, detail = undefined, documentId = undefined } = {}) {
  if (!db || id == null) return { ok: false, error: "no db client / id" };
  const patch = { status, updated_at: new Date().toISOString() };
  if (journalEntryIds && journalEntryIds.length) patch.journal_entry_ids = journalEntryIds.map(String);
  if (detail !== undefined) patch.detail = detail;
  if (documentId !== undefined) patch.document_id = documentId;
  try {
    const upd = await db.from("document_intake").update(patch).eq("id", id).select().single();
    if (upd.error || !upd.data) return { ok: false, error: upd.error?.message || "intake update returned no row" };
    if (upd.data.status !== status) return { ok: false, error: "intake status did not persist" };
    return { ok: true, row: upd.data };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

// The production reconciliation query: pull NON-terminal intake rows for a company straight
// from the population, then apply reconcileIntake. Independent of the recording pipeline.
export async function fetchDroppedIntake(db, companyId, { now, stuckMinutes } = {}) {
  if (!db || !companyId) return { ok: false, error: "no db client / company", dropped: [] };
  try {
    const { data, error } = await db.from("document_intake").select("*")
      .eq("company_id", companyId)
      .not("status", "in", `(${TERMINAL_INTAKE_STATUSES.join(",")})`);
    if (error) return { ok: false, error: error.message, dropped: [] };
    return { ok: true, dropped: reconcileIntake(data || [], { now, stuckMinutes }) };
  } catch (e) { return { ok: false, error: String(e?.message || e), dropped: [] }; }
}

// All intake rows for a company (for the docs-recorded control total — recorded rows
// vs recorded-with-an-entry). Degrades gracefully pre-migration / on error.
export async function fetchIntakeRows(db, companyId) {
  if (!db || !companyId) return { ok: false, rows: [] };
  try {
    const { data, error } = await db.from("document_intake")
      .select("id, status, source, journal_entry_ids, created_at")
      .eq("company_id", companyId);
    if (error) return { ok: false, rows: [], error: error.message };
    return { ok: true, rows: data || [] };
  } catch (e) { return { ok: false, rows: [], error: String(e?.message || e) }; }
}

// sha-256 of a File's bytes (browser) — identity + dupe detection. Best-effort: returns null
// if the platform lacks SubtleCrypto, so intake logging never blocks on it.
export async function hashFile(file) {
  try {
    if (!file || typeof crypto === "undefined" || !crypto.subtle || !file.arrayBuffer) return null;
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
  } catch { return null; }
}
