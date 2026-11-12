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
