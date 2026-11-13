// ═════════════════════════════════════════════════════════════════════════════
// C593 — WHICH INVOICES CAN BE MARKED PAID. Review finding F5.
//
// "Mark paid" sat on every invoice that was not paid — drafts and voided ones included. A
// draft has no entry in the books (nothing is owed until it is sent), so it fell into the
// branch written for invoices issued before A/R existed: it booked cash and income directly
// and, for that branch, never saved the invoice as paid. After a reload the button was back,
// and every click added the income again.
//
// Only an invoice that was SENT (or part-paid) is money a customer owes; only that can be
// collected. The button is not offered otherwise (§9: refusing on click teaches that
// clicking is how you find out).
// ═════════════════════════════════════════════════════════════════════════════
const COLLECTABLE = new Set(["sent", "partial", "overdue"]);

export function canMarkInvoicePaid(inv = {}) {
  const st = String(inv.status || "").toLowerCase();
  if (st === "paid") return { ok: false, why: `${inv.invoice_number || "This invoice"} is already marked paid.` };
  if (st === "void" || st === "voided") return { ok: false, why: `${inv.invoice_number || "This invoice"} was voided, so there is nothing to collect.` };
  if (!COLLECTABLE.has(st)) return { ok: false, why: `${inv.invoice_number || "This invoice"} is still a draft — send it first; nothing is owed until it has been sent.` };
  return { ok: true, why: null };
}

// ★ C710 — AN INVOICE'S STATUS FOLLOWS THE BOOKS. `ar_invoices.status` was written only by this
// screen's own "Mark paid", so an invoice collected anywhere else (Money owed to you, Mark Received,
// a bank match) still read "sent" with a Mark paid button; and one whose collection was REMOVED
// still read "paid", so Mark paid refused while Money owed to you listed it as owed (§9: the flag
// is a cache, the ledger is the truth). A sent invoice with a ledger entry is paid exactly when a
// live collection links that entry (or its row is flagged collected).
export function invoiceStatusFromBooks(inv = {}, ledger = [], settled = null) {
  const st = String(inv.status || "").toLowerCase();
  if (!inv.ledger_id || !["sent", "overdue", "paid"].includes(st)) return inv.status;
  const base = String(inv.ledger_id);
  const rows = (ledger || []).filter((r) => r && String(r.db_entry_id != null ? r.db_entry_id : String(r.id).split("_")[0]) === base);
  if (!rows.length) return inv.status;   // not loaded — trust the saved status
  const collected = (settled && settled.has(base)) || rows.some((r) => r.payment_status === "collected");
  if (collected) return "paid";
  return st === "paid" ? "sent" : inv.status;
}
