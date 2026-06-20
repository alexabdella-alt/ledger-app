// ─────────────────────────────────────────────────────────────────────────────
// Revenue-cycle journal-entry builders (pure), posted through the canonical
// multi-line write path (buildJournalEntry → persistMultiLineEntry).
//
//   #11 deferred-revenue RECEIPT — cash received before the service is delivered is
//       a LIABILITY, not revenue yet:   Dr Cash  /  Cr Deferred Revenue (2300).
//       (Recognition #11b — Dr Deferred Rev / Cr Revenue — happens later, via the
//        contract/recognition path, when the obligation is satisfied.)
//
//   #4 / #16 AR invoice (issued) — Dr A/R / Cr Revenue, plus Cr Sales Tax Payable
//       when a blended sales-tax rate applies (sales tax is a LIABILITY collected on
//       behalf of the state, never revenue). See buildArInvoiceEntry below.
// ─────────────────────────────────────────────────────────────────────────────

import { buildJournalEntry } from "./journalEntries.js";

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// #4 / #16 issued AR invoice:
//   Dr A/R (subtotal + tax)  /  Cr Revenue (subtotal)  [ /  Cr Sales Tax Payable (tax) ]
// Sales tax is a LIABILITY collected for the state, never revenue. `taxRate` is a
// fraction (0.085); pass `taxAmount` to override the computed amount. tax = 0 → a
// clean 2-line Dr A/R / Cr Revenue (backward compatible). Null on invalid inputs.
export function buildArInvoiceEntry({ subtotal, taxRate = 0, taxAmount = null, arCode, revenueCode, salesTaxCode, date = null, customer = "Customer", invoiceNumber = null, dueDate = null, description = null, memo = null } = {}) {
  const sub = r2(subtotal);
  if (!(sub > 0) || !arCode || !revenueCode) return null;
  const tax = r2(taxAmount != null ? taxAmount : sub * (Number(taxRate) || 0));
  if (tax < 0) return null;
  if (tax > 0 && !salesTaxCode) return null;   // can't book tax without the liability account
  const total = r2(sub + tax);
  const lines = [
    { code: arCode, debit: total, credit: 0 },       // Dr A/R — full amount owed (incl. tax)
    { code: revenueCode, debit: 0, credit: sub },    // Cr Revenue — ex-tax
  ];
  if (tax > 0) lines.push({ code: salesTaxCode, debit: 0, credit: tax });   // Cr Sales Tax Payable
  return buildJournalEntry({
    lines, date, source: "ar_invoice",
    description: description || `${customer} – Invoice ${invoiceNumber || ""}`.trim(),
    memo,
    // payment_status/due_date ride in meta → persisted to the JE columns, so the
    // flattened row is an open receivable (mirrors the existing AR-invoice booking).
    meta: { kind: "ar_invoice", invoice_number: invoiceNumber || null, tax, payment_status: "uncollected", due_date: dueDate || null },
  });
}

// #11 receipt: Dr Cash / Cr Deferred Revenue. Null on invalid amount/accounts.
export function buildDeferredRevenueReceiptEntry({ amount, cashCode, deferredRevCode, date = null, vendor = "Customer", description = null, memo = null } = {}) {
  const amt = r2(amount);
  if (!(amt > 0) || !cashCode || !deferredRevCode) return null;
  return buildJournalEntry({
    lines: [
      { code: cashCode, debit: amt, credit: 0 },         // Dr Cash
      { code: deferredRevCode, debit: 0, credit: amt },  // Cr Deferred Revenue (liability)
    ],
    date, source: "manual",
    description: description || `Advance payment – ${vendor}`,
    memo, meta: { kind: "deferred_revenue_receipt" },
  });
}
