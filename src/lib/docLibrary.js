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

// ── THE ENTRY A DOCUMENT BECAME ──────────────────────────────────────────────
// `invoices` are the flattened ledger rows; a document carries `linked_invoice_id`, which
// is the entry's durable id once booking resolved (or its in-session id until then). ONE
// resolver, shared by the card's date and the card's door — the same lookup the detail
// panel's `findSourceDoc` makes from the other side — so "dated by the entry" and "opens
// the entry" cannot disagree about which entry that is.
export function linkedEntryFor(doc = {}, invoices = []) {
  const link = doc.linked_invoice_id;
  if (link == null || link === "") return null;
  const key = String(link);
  return (invoices || []).find((i) => i && (String(i.db_entry_id) === key || String(i.id) === key)) || null;
}

export function documentDate(doc = {}, invoices = []) {
  if (doc.document_date) return { date: doc.document_date, source: DOC_DATE_SOURCE.DOCUMENT };
  const hit = linkedEntryFor(doc, invoices);
  if (hit && hit.date) return { date: hit.date, source: DOC_DATE_SOURCE.LINKED };
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

// ── DURABILITY OF A `storeDocument` RETURN ───────────────────────────────────
// `storeDocument` hands back an OPTIMISTIC in-session id (`Date.now()+Math.random()`)
// whenever the persist fails, so a truthy return says nothing about whether the row
// landed. Two callers already guarded this with an inline regex and a comment; the O97
// durable-first caller — the newest, and the one whose ENTIRE PURPOSE is durability —
// did not, and claimed "file stored — safe to close the tab" off the fallback float.
//
// ★ ONE DEFINITION, because three copies of a uuid test is precisely the shape that let
// the third site quietly omit it. A `documents.id` is a uuid; the fallback never is.
export function isDurableDocId(id) {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// ── THE PLACEHOLDER, AND WHY IT IS NOT ITS OWN VALUE ─────────────────────────
// O97 stores the bytes BEFORE classification, so at write time the type is genuinely
// unknown. It passed the literal `"pending"` — which is not in the CHECK constraint, so
// EVERY durable-first insert was rejected, the storage upload was rolled back, and the
// durable queue this was built to create has been empty since it shipped.
//
// ★ The column is `NOT NULL DEFAULT 'other'`, so "unknown" has no representation of its
// own without a migration — and this file's own rule already settles the trade:
// a document we cannot label is still a document we must KEEP. So the placeholder IS
// 'other', and `stampsOver` below is what stops it staying that way.
export const PLACEHOLDER_DOCUMENT_TYPE = "other";

// May a newly-known type overwrite what is already stored? Only 'other' → specific.
// Monotone by construction: nothing specific is ever downgraded, and a row that was
// only ever 'other' because we had not looked yet gets the answer when we have it.
export function stampsOver(storedType, incomingType) {
  if (!incomingType || !DOCUMENT_TYPES.includes(incomingType)) return false;
  // ★ NOT a downgrade guard — the storedType test below already refuses 'invoice' → 'other'.
  // This one refuses 'other' → 'other': a document classification genuinely cannot label
  // would otherwise issue a checked write setting the value it already holds, on every
  // dedup, forever. Found by a mutation that survived: the line I had described as the
  // downgrade guard could not have mattered for correctness, and the real reason to keep
  // it is narrower than the comment first claimed.
  if (incomingType === PLACEHOLDER_DOCUMENT_TYPE) return false;
  return !storedType || storedType === PLACEHOLDER_DOCUMENT_TYPE;
}

// ── THE DEDUPE STAMP IS ONE DECISION, NOT TWO HALVES ────────────────────────
// O97 stores the bytes BEFORE classification (type = placeholder, link = null). The
// invoice path then calls `storeDocument` again on the SAME bytes with the real type AND
// the invoice it belongs to — and C193's content-hash dedupe hands back the existing row.
// C300 taught that branch to stamp the TYPE it now knows. It never stamped the LINK.
//
// ★ SO EVERY INVOICE DOCUMENT SINCE C300 SHIPPED HAS `linked_invoice_id = NULL`: the row
// exists (the Documents tab lists it), the entry exists (Transactions lists it), and the
// one field that joins them was decided at a moment when nobody had computed it. The
// relink that follows booking updates rows WHERE link = the in-session id — which matched
// nothing, so it moved nothing, silently. A transaction opened from the list showed
// "no source document attached" beside a library that plainly held the file.
//
// Same rule as `stampsOver`, applied to the link: only ever null → value. An existing
// link is NEVER re-pointed here — the same bytes re-uploaded and booked a second time
// (a genuine duplicate) must not move the document off the entry it already backs.
export function linksOver(storedLink, incomingLink) {
  if (incomingLink == null || incomingLink === "") return false;
  return storedLink == null || storedLink === "";
}

// The full patch the dedupe branch should write to the EXISTING row. Empty when there is
// nothing to say, so the caller can skip the write rather than issue a no-op.
export function dedupePatch(existing = {}, { type, linkedId } = {}) {
  const patch = {};
  if (stampsOver(existing.document_type, type)) patch.document_type = type;
  if (linksOver(existing.linked_invoice_id, linkedId)) patch.linked_invoice_id = String(linkedId);
  return patch;
}

// ── THE DOCUMENT'S OWN DATE, FROM WHAT WAS READ OFF IT (C337) ────────────────
// The earliest well-formed invoice date on the document. Never the upload date, never
// today, never a guess: an extraction with no usable date yields null and the card keeps
// saying "uploaded <date>", which is the truth it can stand behind.
export function documentDateFromExtraction(extracted = []) {
  const dates = (extracted || [])
    .map((ex) => String((ex && (ex.date || ex.invoice_date)) || "").slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(d + "T00:00:00Z").getTime()));
  if (!dates.length) return null;
  return dates.sort()[0];
}
