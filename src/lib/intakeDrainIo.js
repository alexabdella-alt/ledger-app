// ─────────────────────────────────────────────────────────────────────────────
// O97 STEP 2 — THE DRAIN (execution half). Deliberately thin, like `shadowIo`.
//
// Reads the rows `planDrain` needs, calls it, recovers the stored bytes for each pick and
// hands them to an injected `enqueue`. All judgement lives in `intakeDrain.js`; this file
// must never acquire any, because it is the only part of the drain that touches I/O.
//
// ★★ ITS ENTIRE WRITE SURFACE IS `document_intake`. A test asserts that every `.insert(` /
// `.update(` / `.delete(` in this file targets that table and nothing else — so "the drain
// re-runs work, it never books" is checkable by reading the file rather than by trusting
// it. The picks go to `enqueue`, which is the SAME pipeline a fresh drop uses; the drain
// deliberately owns no second processing path, because a second path is a second place for
// the two to disagree (·3a).
//
// The client is INJECTED, never imported — that is what keeps the guard meaningful.
//
// ★ THE RE-ENQUEUED ITEM CARRIES THE ORIGINAL `intake_id`. It must never call `logIntake`
// again: a second arrival row for one document would corrupt the completeness ledger's
// population — the one table whose whole value is that it independently knows what came in
// (O60). A retry is the same arrival, tried again.
// ─────────────────────────────────────────────────────────────────────────────

import { setIntakeStatus, TERMINAL_INTAKE_STATUSES, INTAKE_STATUS } from "./documentIntake.js";
import { planDrain, DRAIN_ACTION } from "./intakeDrain.js";

// ── READ ─────────────────────────────────────────────────────────────────────
// Only rows with durable bytes can ever be drained, so the filter is pushed to the
// database — but the SKIP census in `planDrain` still counts what it excluded, because
// "we found nothing" and "there was nothing findable" are different reports (O98).
export async function readDrainableRows({ supabase, companyId }) {
  if (!supabase || !companyId) return { ok: false, rows: [], error: "no db client / company" };
  try {
    const { data, error } = await supabase
      .from("document_intake")
      .select("id, status, document_id, filename, received_at, updated_at, detail")
      .eq("company_id", companyId)
      .not("status", "in", `(${TERMINAL_INTAKE_STATUSES.join(",")})`)
      .not("document_id", "is", null);
    if (error) return { ok: false, rows: [], error: error.message };
    return { ok: true, rows: data || [] };
  } catch (e) {
    return { ok: false, rows: [], error: String(e?.message || e) };
  }
}

// ── THE DENOMINATOR ──────────────────────────────────────────────────────────
// `drainProgressCopy` says "N of M sorted", and M has to be a number we actually hold or
// the sentence is a guess wearing a total (§9). Both are head-counts over the rows that
// HAVE durable bytes — the only population the drain can speak for. Rows without them are
// counted separately by the planner and reported as unresumable, never folded in here.
export async function readDrainCensus({ supabase, companyId }) {
  if (!supabase || !companyId) return { ok: false, stored: 0, done: 0 };
  const countOf = async (apply) => {
    let q = supabase.from("document_intake").select("id", { count: "exact", head: true })
      .eq("company_id", companyId).not("document_id", "is", null);
    q = apply(q);
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return count || 0;
  };
  try {
    const stored = await countOf((q) => q);
    const done = await countOf((q) => q.in("status", TERMINAL_INTAKE_STATUSES));
    return { ok: true, stored, done };
  } catch (e) {
    // A census we could not read is reported as unread, never as zero — a zero here would
    // render "Nothing waiting." over a queue that is full.
    return { ok: false, stored: 0, done: 0, error: String(e?.message || e) };
  }
}

// ── RECOVER THE BYTES ────────────────────────────────────────────────────────
// The whole point of step 1: the file is in Storage, so a refresh, a closed tab or a
// throttled hour costs time and nothing else.
//
// ★ A ROW WHOSE DOCUMENT HAS NO `storage_path` IS NOT RETRYABLE, and says so. That is the
// dedup branch's shape (identical bytes linked to an existing document) and a store that
// failed after its metadata insert — in both cases there is nothing to download, and
// retrying it forever would be the C195(7) guard-with-an-empty-input all over again.
export async function fetchStoredFile({ supabase, documentId }) {
  if (!supabase || !documentId) return { ok: false, error: "no db client / document id" };
  try {
    const { data: doc, error } = await supabase
      .from("documents")
      .select("id, name, mime_type, storage_path")
      .eq("id", documentId)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!doc) return { ok: false, error: "document row is gone", retryable: false };
    if (!doc.storage_path) return { ok: false, error: "document has no stored file", retryable: false };

    const dl = await supabase.storage.from("documents").download(doc.storage_path);
    if (dl.error || !dl.data) return { ok: false, error: dl.error?.message || "download returned nothing" };

    const name = doc.name || "document";
    const type = doc.mime_type || dl.data.type || "application/octet-stream";
    // `File` where the platform has it (browser), the Blob otherwise — every consumer
    // reads `.name` / `.type` / `.arrayBuffer()`, all of which we set either way.
    let file;
    try {
      file = new File([dl.data], name, { type });
    } catch {
      file = dl.data;
      try { Object.defineProperty(file, "name", { value: name, configurable: true }); } catch { /* frozen blob */ }
    }
    return { ok: true, file, document: doc };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// ── THE PASS ─────────────────────────────────────────────────────────────────
// `enqueue({ intakeId, documentId, file, filename })` puts the work back through the
// normal upload pipeline. `excludeIntakeIds` is the rows this tab is already working on —
// without it, a long-running file whose lease has expired IN THIS SAME TAB would be picked
// up a second time and processed twice, which is the O123 double-post shape wearing an
// intake row.
export async function runIntakeDrain({
  supabase, companyId, now, limit = 5, opts = {},
  enqueue, excludeIntakeIds = [],
} = {}) {
  if (!supabase || !companyId) return { ok: false, error: "no db client / company" };
  if (typeof enqueue !== "function") return { ok: false, error: "no enqueue" };
  if (!now) return { ok: false, error: "no clock supplied" };

  const read = await readDrainableRows({ supabase, companyId });
  if (!read.ok) return { ok: false, error: read.error };

  const busy = new Set((excludeIntakeIds || []).map(String));
  const rows = read.rows.filter((r) => !busy.has(String(r.id)));

  const plan = planDrain({ rows, now, limit, opts });

  // Holds first: a row past the give-up box must stop being retried even if everything
  // below fails, and it is written with the reason the planner stated — never one composed
  // here alongside it (§9, describe from the record).
  const held = [];
  for (const h of plan.hold) {
    const res = await setIntakeStatus(supabase, h.row.id, INTAKE_STATUS.HELD, { detail: h.detail });
    held.push({ id: h.row.id, reason: h.reason, ok: !!res.ok, error: res.ok ? null : res.error });
  }

  const started = [], unrecoverable = [];
  for (const p of plan.pick) {
    const got = await fetchStoredFile({ supabase, documentId: p.row.document_id });
    if (!got.ok) {
      // Retryable failure (a network blip on the download) → leave the row alone; the next
      // pass tries again. Non-retryable (no stored file at all) → hold it with the reason,
      // because a row we can never recover is not pending work, it is a thing to be told.
      if (got.retryable === false) {
        await setIntakeStatus(supabase, p.row.id, INTAKE_STATUS.HELD, {
          detail: `We stored a record of ${p.row.filename || "this file"} but not the file itself, so we can't pick it back up — it would need uploading again.`,
        });
        unrecoverable.push({ id: p.row.id, error: got.error });
      } else {
        unrecoverable.push({ id: p.row.id, error: got.error, willRetry: true });
      }
      continue;
    }
    enqueue({
      intakeId: p.row.id,
      documentId: p.row.document_id,
      file: got.file,
      filename: got.file?.name || p.row.filename || "document",
    });
    started.push(p.row.id);
  }

  // The census is read AFTER the pass, so `done` includes anything this pass just resolved.
  const census = await readDrainCensus({ supabase, companyId });

  return { ok: true, plan, started, held, unrecoverable, census };
}

export { DRAIN_ACTION };
