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
// ── PER-LINE AND MULTI-JURISDICTION SALES TAX (§12's deferred sales-tax case) ─
//
// The built case applies ONE blended rate to the whole invoice. That is right for a business
// selling one kind of thing in one place, and wrong the moment either changes: a restaurant
// charges tax on prepared food and often none on grocery items; a business shipping across a
// state line charges the DESTINATION's rate, not its own.
//
// ★★★ THE FAILURE A BLENDED RATE PRODUCES IS THE DANGEROUS KIND: the invoice total can still
// be right while the SPLIT is wrong — and the split is what gets filed. **You remit to a
// jurisdiction, not to an average.** An invoice that collects the correct $86.25 and
// attributes it to the wrong state is a correct-looking document and a wrong return.
//
// ★★ SO THE JURISDICTION BREAKDOWN IS CARRIED, NOT COLLAPSED. The GL still credits one Sales
// Tax Payable account — splitting the LIABILITY per jurisdiction would need an account per
// state and a migration, and is a bigger decision — but the per-jurisdiction amounts ride in
// the entry's metadata, so a return can be prepared from the books rather than reconstructed
// from invoices. **Collapsing them at booking time destroys the only place that fact exists.**

// Lines: [{ amount, taxRate, jurisdiction, taxExempt }]. Returns the computed tax with its
// breakdown, or null when a line is unusable — never a guessed rate.
export function computeLineTax(lines = []) {
  const rows = (lines || []).filter(Boolean);
  if (!rows.length) return null;
  const byJurisdiction = {};
  let subtotal = 0;
  let tax = 0;
  for (const l of rows) {
    const amt = r2(l.amount);
    if (!(amt > 0)) return null;                       // a zero or negative line is not a sale
    subtotal = r2(subtotal + amt);
    // ★ EXEMPT IS NOT THE SAME AS ZERO-RATED, and both are different from "no rate given".
    // An exempt line is a decision someone made; a missing rate is a gap. Only the first is
    // safe to treat as no tax.
    if (l.taxExempt) continue;
    const rate = Number(l.taxRate);
    if (!Number.isFinite(rate) || rate < 0) return null;
    const j = String(l.jurisdiction || "").trim() || "unspecified";
    const lineTax = r2(amt * rate);
    if (lineTax > 0) {
      byJurisdiction[j] = r2((byJurisdiction[j] || 0) + lineTax);
      tax = r2(tax + lineTax);
    }
  }
  return { subtotal, tax, byJurisdiction };
}

// The same entry shape as the single-rate builder, with the breakdown in meta.
export function buildArInvoiceEntryPerLine({ lines = [], arCode, revenueCode, salesTaxCode, date = null, customer = "Customer", invoiceNumber = null, dueDate = null, description = null, memo = null } = {}) {
  const t = computeLineTax(lines);
  if (!t) return null;
  const entry = buildArInvoiceEntry({
    subtotal: t.subtotal, taxAmount: t.tax,
    arCode, revenueCode, salesTaxCode, date, customer, invoiceNumber, dueDate, description, memo,
  });
  if (!entry) return null;
  // ★ THE BREAKDOWN IS ADDED, NEVER SUBSTITUTED FOR THE TOTAL. `tax` stays exactly what the
  // control total cross-foots against (C241), so adding jurisdictions cannot quietly change
  // the figure the accuracy net compares.
  return { ...entry, meta: { ...entry.meta, tax_by_jurisdiction: t.byJurisdiction } };
}

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
