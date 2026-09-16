// ─────────────────────────────────────────────────────────────────────────────
// Send-Invoice draft shape (pure). The Send Invoice state (sendInvoiceDraftState)
// starts as null; the view masks that with `draft = state || newInvoiceDraft()` for
// RENDER, but functional updates must never read `.line_items` off the raw null
// state. `draftBase(state, fallback)` returns a guaranteed-complete object to spread
// from, so a fresh-draft interaction can't throw "Cannot read properties of null".
// Centralizing the factory also keeps the default draft, the "+ New" button, and the
// sales-tax prefill on one complete shape.
// ─────────────────────────────────────────────────────────────────────────────

import { todayLocal } from "./format";

export function emptyInvoiceLine() {
  return { id: Date.now() + Math.random(), description: "", qty: 1, rate: "", amount: 0 };
}

// A complete new-invoice draft. Always has line_items (≥1) and tax_rate; tax_rate is
// pre-filled from the saved company default (percent) when non-zero, else blank.
export function newInvoiceDraft({ invoiceNumber = "", salesTaxRate = 0, issueDate = null } = {}) {
  return {
    invoice_number: invoiceNumber,
    customer: "", customer_email: "", customer_address: "",   // C475 — printed under BILL TO
    issue_date: issueDate || todayLocal(),   // a new invoice's date defaults to today — local, not UTC
    due_date: "", notes: "", terms: "Net 30",
    line_items: [emptyInvoiceLine()],
    tax_rate: salesTaxRate ? String(salesTaxRate) : "",
    status: "draft",
  };
}

// The object a functional draft update should spread from: the live state if present,
// otherwise the resolved fallback draft (never null → safe to read .line_items).
export function draftBase(rawState, fallback) {
  const base = rawState || fallback || {};
  // Belt-and-suspenders: a partial state (e.g. an older `{tax_rate}` from a prior bug)
  // gets line_items backfilled so reads can't throw.
  return Array.isArray(base.line_items) ? base : { ...base, line_items: (fallback && fallback.line_items) || [emptyInvoiceLine()] };
}

// ─────────────────────────────────────────────────────────────────────────────
// C412 — WHAT STANDS BETWEEN THIS DRAFT AND "SEND", SAID BEFORE THE CLICK.
//
// The Send button was enabled over an incomplete draft and refused on click with a toast
// ("Add a customer name first.") — O124: a control that refuses on click teaches you that
// clicking is how you find out. The same three checks the handler makes, as sentences the
// screen shows beside a DISABLED button (C407's pattern on the sign-off card). The handler
// keeps them as its own guard, through this one function, so the two cannot disagree.
// ─────────────────────────────────────────────────────────────────────────────
export function invoiceSendBlockers(draft = {}, subtotal = 0, sentInvoices = []) {
  const out = [];
  if (!String(draft.customer || "").trim()) out.push("Add the customer's name.");
  if (!String(draft.customer_email || "").trim()) out.push("Add the customer's email address.");
  if (!(Number(subtotal) > 0)) out.push("Add at least one line with an amount.");
  // C512 — the number is editable and nothing refused a repeat: two customers could hold the
  // same invoice number. A number already on a stored invoice (other than this draft's own)
  // blocks the send before the click, in the list with the other reasons.
  const num = String(draft.invoice_number || "").trim().toLowerCase();
  if (num && (sentInvoices || []).some((i) => i && String(i.invoice_number || "").trim().toLowerCase() === num && String(i.id) !== String(draft.id))) {
    out.push(`Invoice number ${draft.invoice_number} is already used — pick another.`);
  }
  return out;
}

// C438 — THE AMOUNT OF A SENT INVOICE INCLUDES ITS SALES TAX. The list and the legacy
// mark-paid path summed line items only, so a $1,299.00 invoice (with $99.00 tax) read as
// $1,200.00 in the list and, on the path with no ledger entry, was collected for $1,200.00.
export function invoiceTotalOf(inv = {}) {
  const sub = (inv.line_items || []).reduce((s, l) => s + (Number(l?.amount) || 0), 0);
  return Math.round((sub + (Number(inv.tax_amount) || 0)) * 100) / 100;
}

// C450 — THE DUE DATE THE INVOICE SHOWS FOLLOWS THE TERMS WHEN NONE WAS TYPED. The draft
// defaults to terms "Net 30" and an empty due date, so the printed invoice read "Due Date:
// On Receipt · Terms: Net 30" — two claims that contradict each other, on the document a
// customer pays from. A typed due date wins; otherwise the terms decide; "On Receipt"
// terms (or no terms) read as due on receipt.
import { deriveDueDate as _deriveDueDate } from "./format.js";
export function invoiceDueLabel(draft = {}, fmt = (d) => d) {
  if (draft.due_date) return fmt(draft.due_date);
  const derived = _deriveDueDate(draft.issue_date, draft.terms);
  if (derived && derived !== draft.issue_date) return fmt(derived);
  return "On receipt";
}

// ─────────────────────────────────────────────────────────────────────────────
// C473 — A CUSTOMER'S SAVED TERMS AND EMAIL FILL THE DRAFT WHEN THEY ARE PICKED.
// "Payment terms" on the Customers form was typed, saved, displayed — and the invoice form
// still opened on Net 30 and a blank email for that customer. The select offers five
// choices, so a stored "net 15" maps onto "Net 15" by its day count; a term the select
// cannot express (Net 45) is left as it was rather than shown as a blank option.
// ─────────────────────────────────────────────────────────────────────────────
import { termsToDays as _termsToDays } from "./format.js";
export const INVOICE_TERM_OPTIONS = ["On Receipt", "Net 15", "Net 30", "Net 60", "Net 90"];
export function customerDefaultsFor(contact, draft = {}) {
  if (!contact) return {};
  const out = {};
  if (!draft.customer_email && contact.email) out.customer_email = contact.email;
  if (!draft.customer_address && contact.mailing_address) out.customer_address = contact.mailing_address;   // C475
  const days = _termsToDays(contact.payment_terms);
  if (days != null) {
    const opt = days === 0 ? "On Receipt" : `Net ${days}`;
    if (INVOICE_TERM_OPTIONS.includes(opt) && draft.terms !== opt) out.terms = opt;
  }
  return out;
}

// C511 — the next invoice number was `INV-${count + 1}`: a persist that failed (C350), a
// removed invoice, or a custom number in the list handed the SAME number to the next
// customer-facing document. It is one past the highest INV-number seen, never a count.
export function nextInvoiceNumber(sentInvoices = []) {
  let max = 0;
  for (const inv of sentInvoices || []) {
    const m = String(inv?.invoice_number || "").match(/^INV-(\d+)$/i);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `INV-${String(max + 1).padStart(4, "0")}`;
}
