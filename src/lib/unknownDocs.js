// ─────────────────────────────────────────────────────────────────────────────
// UNKNOWN DOCUMENTS, PERSISTED (C364).
//
// `unknown_documents` has existed since the baseline schema with exactly the shape the
// catch-all's in-session record has — `proposed_journal_entry`, `watch_for`, `watch_matches`,
// `posted` — and nothing in `src/` ever named the table. So the AI's explanation, its drafted
// entry and its watch-for triggers lived in the tab that dropped the file (O97's class), the
// Review section was empty after a reload, and a match that fired against a later invoice
// was gone with the tab. `document_id` is NOT NULL, which is the right constraint: a record
// about a file we did not keep is a record about nothing, so a row is written only when the
// durable-first store (C300) gave us an id.
//
// Both directions in one file, the `arInvoiceRows` / `buildIntakeRow` discipline, so the
// writer and the reader cannot drift.
// ─────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isDbUnknownDocId = (id) => typeof id === "string" && UUID_RE.test(id);

// The row an in-session record becomes. Returns null when there is no durable document —
// the column refuses it, and the caller keeps the record in memory rather than lying.
export function unknownDocRow(rec, { companyId, documentId } = {}) {
  if (!rec || !companyId || !documentId) return null;
  return {
    company_id: companyId,
    document_id: documentId,
    document_type_detected: rec.document_type || null,
    ai_explanation: rec.ai_explanation || null,
    entry_needed: !!rec.entry_needed,
    entry_summary: rec.entry_summary || null,
    proposed_journal_entry: rec.journal_entry || null,
    watch_for: Array.isArray(rec.watch_for) ? rec.watch_for : [],
    watch_matches: Array.isArray(rec.watch_matches) ? rec.watch_matches : [],
    posted: !!rec.posted,
    dismissed: !!rec.dismissed,
  };
}

// The in-session shape from a stored row. `name` comes from the joined document when the
// load asks for it; `db_id` marks the record as durable so the markers can be written back.
export function unknownDocFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    db_id: row.id,
    document_id: row.document_id,
    name: row.documents?.name || row.name || "Document",
    uploaded_at: row.created_at,
    document_type: row.document_type_detected || "Unknown Document",
    ai_explanation: row.ai_explanation || "",
    entry_needed: !!row.entry_needed,
    entry_summary: row.entry_summary || null,
    journal_entry: row.proposed_journal_entry || null,
    no_entry_reason: null,
    watch_for: Array.isArray(row.watch_for) ? row.watch_for : [],
    watch_matches: Array.isArray(row.watch_matches) ? row.watch_matches : [],
    posted: !!row.posted,
    dismissed: !!row.dismissed,
  };
}

// The columns the load must ask for — the reader names what it needs (C322's lesson).
export const UNKNOWN_DOC_SELECT = "*, documents(name)";
