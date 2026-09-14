// ─────────────────────────────────────────────────────────────────────────────
// SENT INVOICES, PERSISTED (C350).
//
// `loadAllData` has always READ `ar_invoices` (+ `ar_invoice_lines`) into `sentInvoices`, and
// nothing has ever WRITTEN them: `persistSent` was a `setSentInvoices` and nothing more. So an
// invoice you sent existed until you reloaded, and after that only its A/R journal entry
// survived — with the "mark paid" button on the reloaded list unable to find that entry,
// because the load mapping dropped `journal_entry_id`. The O97 in-memory class, on the
// surface the operator named first when asked what invoicing needs.
//
// Two pure shapes: the rows a sent invoice becomes, and the invoice a row becomes. Both
// directions in one file so they cannot drift — the same round-trip discipline as the
// intake ledger's `buildIntakeRow` / `fetchIntakeRows` pair.
// ─────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isDbInvoiceId = (id) => typeof id === "string" && UUID_RE.test(id);

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

// The header + line rows for `ar_invoices` / `ar_invoice_lines`. `total` is subtotal + tax,
// computed here from the lines so the stored total can never disagree with the stored lines.
export function arInvoiceRows(inv, { companyId, customerId = null, userId = null, taxAmount = 0 } = {}) {
  if (!inv || !companyId) throw new Error("arInvoiceRows: invoice and companyId are required");
  const lines = (inv.line_items || []).map((l, i) => ({
    company_id: companyId,
    description: String(l.description || "Item"),
    quantity: Number(l.qty ?? l.quantity ?? 1) || 1,
    unit_rate: money(l.rate ?? l.unit_rate ?? 0),
    amount: money(l.amount),
    sort_order: i,
  }));
  const subtotal = money(lines.reduce((s, l) => s + l.amount, 0));
  const tax = money(taxAmount);
  const header = {
    company_id: companyId,
    journal_entry_id: inv.ledger_id || null,
    customer_id: customerId || null,
    invoice_number: String(inv.invoice_number || ""),
    issue_date: inv.issue_date || null,
    due_date: inv.due_date || null,
    terms: inv.terms || "Net 30",
    subtotal,
    tax_amount: tax,
    total: money(subtotal + tax),
    status: inv.status === "paid" ? "paid" : "sent",
    notes: inv.notes || null,
    paid_at: inv.paid_at || null,
    created_by: userId || null,
    updated_at: new Date(0).toISOString(),   // caller overwrites with its own clock
  };
  return { header, lines };
}

// The in-session shape from a stored row. `ledger_id` IS `journal_entry_id` — the reload
// mapping used to drop it, which is why "mark paid" after a reload booked a second revenue
// entry instead of clearing the A/R it had already booked.
export function sentInvoiceFromRow(ar) {
  return {
    id: ar.id,
    invoice_number: ar.invoice_number,
    customer: ar.contacts?.name || ar.customer_name || "",
    customer_email: ar.contacts?.email || "",
    issue_date: ar.issue_date,
    due_date: ar.due_date,
    terms: ar.terms,
    notes: ar.notes || "",
    status: ar.status,
    paid_at: ar.paid_at || null,
    ledger_id: ar.journal_entry_id || null,
    tax_amount: Number(ar.tax_amount) || 0,
    line_items: (ar.ar_invoice_lines || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map((l) => ({
      id: l.id, description: l.description, qty: Number(l.quantity), rate: Number(l.unit_rate), amount: Number(l.amount),
    })),
  };
}
