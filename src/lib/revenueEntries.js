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
