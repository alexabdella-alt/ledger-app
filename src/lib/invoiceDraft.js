// ─────────────────────────────────────────────────────────────────────────────
// Send-Invoice draft shape (pure). The Send Invoice state (sendInvoiceDraftState)
// starts as null; the view masks that with `draft = state || newInvoiceDraft()` for
// RENDER, but functional updates must never read `.line_items` off the raw null
// state. `draftBase(state, fallback)` returns a guaranteed-complete object to spread
// from, so a fresh-draft interaction can't throw "Cannot read properties of null".
// Centralizing the factory also keeps the default draft, the "+ New" button, and the
// sales-tax prefill on one complete shape.
// ─────────────────────────────────────────────────────────────────────────────

export function emptyInvoiceLine() {
  return { id: Date.now() + Math.random(), description: "", qty: 1, rate: "", amount: 0 };
}

// A complete new-invoice draft. Always has line_items (≥1) and tax_rate; tax_rate is
// pre-filled from the saved company default (percent) when non-zero, else blank.
export function newInvoiceDraft({ invoiceNumber = "", salesTaxRate = 0, issueDate = null } = {}) {
  return {
    invoice_number: invoiceNumber,
    customer: "", customer_email: "",
    issue_date: issueDate || new Date().toISOString().slice(0, 10),
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
