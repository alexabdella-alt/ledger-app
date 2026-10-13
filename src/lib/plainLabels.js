// ─────────────────────────────────────────────────────────────────────────────
// C580 — INTERNAL IDS NEVER REACH AN OWNER'S EYES AS IDS.
//
// The Audit trail printed its action ids with the underscores swapped for spaces —
// "account materialized", "qbo import undo unmarked", "recode" — and Documents printed its
// type ids through CSS capitalize, so "bank_statement" read "Bank_statement". Two screens
// showing the machine's names for things. These turn an id into words: a hand-written label
// where one is worth writing, and a converter for the long tail that removes underscores and
// swaps the internal vocabulary for the product's own. A test runs EVERY action id logged
// anywhere in src/ through it.
// ─────────────────────────────────────────────────────────────────────────────

const ACTION_LABELS = {
  invoice_booked: "Recorded a document", invoice_uploaded: "Uploaded a document", invoice_rejected: "Turned down a document",
  invoice_deleted: "Removed a transaction", invoice_restored: "Brought back a transaction", invoice_paid: "Marked a bill paid",
  invoice_sent: "Sent an invoice", invoice_created: "Created an invoice", invoice_printed: "Printed an invoice",
  invoice_attached: "Matched a document to a payment", mark_paid: "Marked paid",
  ai_recode: "Assistant changed a category", recode: "Changed a category", recode_sweep: "Changed the category on older transactions",
  account_materialized: "Added a category", coa_added: "Added a category", coa_edited: "Edited a category", coa_deleted: "Deleted a category",
  coa_template_applied: "Set up categories for your type of business",
  contact_added: "Added a contact", contact_created: "Added a contact", contact_updated: "Updated a contact",
  payroll_posted: "Recorded payroll", payroll_parsed: "Read a payroll report",
  recurring_posted: "Added a regular cost to bills", recurring_created: "Set up a regular cost", recurring_deleted: "Removed a regular cost",
  reconciliation_completed: "Matched books to the bank", bank_reconciled: "Matched books to the bank",
  opening_balances_posted: "Saved starting balances", cutoff_date_set: "Set the start date",
  entry_reversed: "Undid a transaction", entry_reversal_undone: "Restored an undone transaction",
  "1099_sent": "Marked a 1099 sent", "1099_flagged": "Flagged a vendor for a 1099", "1099_exported": "Downloaded 1099 data",
  qbo_import: "Imported from QuickBooks", qbo_import_undone: "Undid a QuickBooks import",
  contract_uploaded: "Uploaded a contract", contract_deleted: "Removed a contract", contract_restored: "Brought back a contract",
  settings_saved: "Changed settings", legal_form_set: "Set how the business files taxes",
  invite_sent: "Invited someone", invite_revoked: "Canceled an invite",
  period_signed_off: "Signed off a month", period_reopened: "Reopened a month",
  data_export: "Exported data", vendor_teach_in: "Taught the vendor list from old statements",
};

// Internal words → the product's words, applied word by word to anything without a label.
const WORDS = {
  ai: "assistant", qbo: "QuickBooks", coa: "category", gl: "category", recode: "category change", recon: "bank match",
  reconciliation: "bank match", reconciled: "matched to the bank", materialized: "created", posted: "recorded", post: "record",
  persist: "", write: "", stamp: "", meta: "details", pre: "before the", booked: "recorded", booking: "recording", reversal: "undo", autoposted: "recorded automatically", intake: "upload", anomaly: "unusual activity", je: "entry",
  opening: "starting", cutoff: "start date", precutoff: "before the start date", invoice: "document", txn: "transaction",
  undo: "undo", unmarked: "not marked", ap: "bills", ar: "money owed", fixed: "fixed", asset: "asset",
};

const sentence = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function auditActionLabel(id) {
  const key = String(id || "").trim();
  if (!key) return "Activity";
  if (ACTION_LABELS[key]) return ACTION_LABELS[key];
  const words = key.toLowerCase().split(/[_\s]+/).filter(Boolean);
  const failed = words[words.length - 1] === "failed" || words[words.length - 1] === "failure";
  const core = (failed ? words.slice(0, -1) : words).map((w) => (w in WORDS ? WORDS[w] : w)).filter(Boolean).join(" ");
  return sentence(failed ? `${core} — didn't save` : core);
}

const DOC_TYPES = {
  invoice: "Invoice", bill: "Bill", receipt: "Receipt", bank_statement: "Bank statement", contract: "Contract",
  payroll: "Payroll report", qbo: "QuickBooks file", unknown: "Other",
};
export function docTypeLabel(id) {
  const key = String(id || "").trim();
  if (key === "all") return "All";
  return DOC_TYPES[key] || sentence(key.replace(/_/g, " ")) || "Other";
}
