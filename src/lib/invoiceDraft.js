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
    customer: "", customer_email: "",
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
export function invoiceSendBlockers(draft = {}, subtotal = 0) {
  const out = [];
  if (!String(draft.customer || "").trim()) out.push("Add the customer's name.");
  if (!String(draft.customer_email || "").trim()) out.push("Add the customer's email address.");
  if (!(Number(subtotal) > 0)) out.push("Add at least one line with an amount.");
  return out;
}
