// ═════════════════════════════════════════════════════════════════════════════
// C750 — WHICH ENTRIES HAVE THEIR RECEIPT SAVED, IN ONE PLACE.
//
// A photo or PDF dropped on Home is stored before it is read and linked to the entry it booked
// (`documents.linked_invoice_id`). The detail panel already showed it — but only once you opened
// the entry, so nobody could see at a glance which purchases were backed by a receipt and which
// were not. The list now marks them (📎), and the list and the panel answer "is there a receipt?"
// from this one function, so they cannot disagree.
//
// A flattened multi-line row carries its own `id` and the entry's `db_entry_id`; a document may
// be linked to either, so both are checked (the rule the panel has always used).
// ═════════════════════════════════════════════════════════════════════════════

export const RECEIPT_MARK = "paperclip";   // C762 — an icon name (components/Icon.jsx), not an emoji
export const RECEIPT_MARK_LABEL = "Receipt saved — open to see it";

// Every id some document is linked to, as strings.
export function linkedDocIds(docs = []) {
  const ids = new Set();
  for (const d of docs || []) {
    if (d && d.linked_invoice_id != null && d.linked_invoice_id !== "") ids.add(String(d.linked_invoice_id));
  }
  return ids;
}

const idsOf = (inv) => [inv && inv.id, inv && inv.db_entry_id].filter((x) => x != null && x !== "").map(String);

// The document saved for this entry, or undefined.
export function sourceDocFor(inv, docs = []) {
  const ids = idsOf(inv);
  if (!ids.length) return undefined;
  return (docs || []).find((d) => d && d.linked_invoice_id != null && ids.includes(String(d.linked_invoice_id)));
}

// Fast check for a whole list: pass `linkedDocIds(docs)` once.
export function hasSourceDoc(inv, linkedIds) {
  if (!linkedIds || !linkedIds.size) return false;
  return idsOf(inv).some((id) => linkedIds.has(id));
}

// The "no receipt yet" box on an entry, in an owner's words. On a phone a camera button comes
// first (the Home button's behaviour); the file button covers a PDF, a screenshot or a computer.
export const RECEIPT_ADD_COPY = {
  none: "No receipt or bill saved for this yet.",
  camera: "Take a photo",
  file: "↑ Add a file",
  busy: "Saving…",
  saved: "Saved ✓ — it's attached to this entry",
};

// The file's kind in a word — never a MIME type like "application/pdf" on an owner's screen.
export function fileKindWord(mediaType = "") {
  const t = String(mediaType || "").toLowerCase();
  if (t === "application/pdf") return "PDF";
  if (t.startsWith("image/")) return "Photo";
  if (/csv|excel|spreadsheet/.test(t)) return "Spreadsheet";
  return "File";
}

// The section's heading on the owner's seat (the accountant keeps "SOURCE DOCUMENT").
export function receiptHeading(isIncome = false) {
  return isIncome ? "INVOICE" : "RECEIPT OR BILL";
}

// Whether an entry could have a receipt of its own. A starting balance or a payment (the bill it
// pays carries the receipt) never does — so no empty "add one" box is offered on them.
export function canHaveReceipt(inv, { settle = null } = {}) {
  if (!inv) return false;
  if (inv.source === "opening_balance") return false;
  if (settle) return false;
  return true;
}
