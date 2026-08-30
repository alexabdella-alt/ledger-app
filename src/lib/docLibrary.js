// ─────────────────────────────────────────────────────────────────────────────
// THE DOCUMENT LIBRARY — three claims the screen made and did not keep.
//
//   (1) Its header says **"stored and searchable"** and there was no search input.
//   (2) Every card shows the UPLOAD date, so a February bank statement uploaded in August
//       reads "Aug 25" — and "find me the January statement" becomes "remember which day
//       you uploaded it".
//   (3) The universal path calls `storeDocument(…, "invoice", …)` with the type HARDCODED,
//       so a utility bill, a receipt and a register all file as "Invoice" — and the filter
//       chips imply a taxonomy the data does not have.
//
// ★ (2) IS FIXED WITHOUT A MIGRATION BY DERIVING, NOT GUESSING. A document linked to a
// journal entry has that entry's date, which IS the document's economic date — the day the
// money moved, not the day someone got round to uploading it. **And the card says which
// one it is showing**, because "Feb 3" and "uploaded Aug 25" are different facts and a
// library that silently mixes them is worse than one that only ever showed the upload date.
// A real `document_date` column (migration `077`, ▶ HOLD) covers the unlinked case.
//
// Pure.
// ─────────────────────────────────────────────────────────────────────────────

export const DOC_DATE_SOURCE = {
  DOCUMENT: "document",   // the document's own date, once `077` lands
  LINKED: "linked",       // the date of the entry it produced — the economic date
  UPLOADED: "uploaded",   // all we know
};

// `invoices` are the flattened ledger rows; a document carries `linked_invoice_id`.
export function documentDate(doc = {}, invoices = []) {
  if (doc.document_date) return { date: doc.document_date, source: DOC_DATE_SOURCE.DOCUMENT };
  const link = doc.linked_invoice_id;
  if (link != null && link !== "") {
    const key = String(link);
    const hit = (invoices || []).find((i) => i && (String(i.db_entry_id) === key || String(i.id) === key));
    if (hit && hit.date) return { date: hit.date, source: DOC_DATE_SOURCE.LINKED };
  }
  return { date: doc.uploaded_at || doc.created_at || null, source: DOC_DATE_SOURCE.UPLOADED };
}

// The label under a card. Says WHICH date it is whenever that is not obvious, because a
// library that silently mixes "when this happened" with "when you sent it" is the same
// class of quiet wrongness as everything else in this file's neighbourhood.
export function documentDateLabel(d) {
  if (!d || !d.date) return null;
  return d.source === DOC_DATE_SOURCE.UPLOADED ? "uploaded" : null;
}

const norm = (s) => String(s == null ? "" : s).toLowerCase();

// Filename + type + date range. Deliberately NOT content search — we do not hold the
// extracted text, and a search box that silently only looks at filenames while implying
// otherwise would be one more claim this screen does not keep.
export function filterDocuments(docs = [], { query = "", type = "all", from = null, to = null } = {}, invoices = []) {
  const q = norm(query).trim();
  const terms = q ? q.split(/\s+/) : [];
  return (docs || []).filter((d) => {
    if (!d) return false;
    if (type !== "all" && d.type !== type) return false;
    if (from || to) {
      const { date } = documentDate(d, invoices);
      const ymd = String(date || "").slice(0, 10);
      if (!ymd) return false;                      // undated cannot satisfy a date filter
      if (from && ymd < from) return false;
      if (to && ymd > to) return false;
    }
    if (!terms.length) return true;
    // Every term must appear somewhere — so "roma jan" narrows rather than widens, which
    // is what a person means by typing two words.
    const hay = `${norm(d.name)} ${norm(d.type)} ${norm((d.tags || []).join(" "))}`;
    return terms.every((t) => hay.includes(t));
  });
}

// ── TYPE, DERIVED RATHER THAN ASSUMED ────────────────────────────────────────
// The `documents_document_type_check` constraint allows exactly these. Anything else is
// stored as 'other' rather than rejected — a document we cannot label is still a document
// we must keep, and losing the file to protect a taxonomy would be the wrong trade.
export const DOCUMENT_TYPES = ["invoice", "contract", "bank_statement", "payroll", "receipt", "1099", "other"];

export function documentTypeFor(classified, fallback = "other") {
  const t = norm(classified).trim().replace(/[\s-]+/g, "_");
  if (DOCUMENT_TYPES.includes(t)) return t;
  // The classifier's vocabulary is not identical to the column's; map what differs rather
  // than widening the constraint.
  const ALIASES = { bill: "invoice", statement: "bank_statement", bank: "bank_statement", payroll_register: "payroll", expense: "receipt" };
  if (ALIASES[t]) return ALIASES[t];
  return DOCUMENT_TYPES.includes(fallback) ? fallback : "other";
}
