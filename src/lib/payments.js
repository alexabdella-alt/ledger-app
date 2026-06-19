// ─────────────────────────────────────────────────────────────────────────────
// Payment-posting integrity (Step 1). When a bill is marked paid it must post a
// balanced GL movement so the Accounts Payable balance actually falls — not just
// flip a payment_status flag. Likewise an invoice collected posts Dr Cash / Cr AR.
//
//   AP bill paid (booked Dr Expense / Cr AP|Accrued):  Dr <AP|Accrued>  Cr Cash
//   AR invoice collected (booked Dr AR / Cr Revenue):  Dr Cash          Cr AR
//
// CRITICAL: a bill booked DIRECT-TO-CASH (offset = Cash) was already settled at
// booking, so paying it is a GL no-op (flag only) — posting again would
// double-credit Cash. We only post when the bill's offset was the AP/Accrued
// liability (AP side) or AR (AR side). These are pure helpers; the caller posts
// the returned entry through the canonical persistJournalEntry path and links it
// back to the originating bill (import_metadata.payment_for) for reversal.
// ─────────────────────────────────────────────────────────────────────────────

export const PAYMENT_KINDS = { ap: "ap_payment", ar: "ar_collection" };

const num = n => Number(n) || 0;

// Does paying/collecting this entry require a GL movement? Only when its booked
// offset is the AP/Accrued liability (AP side) or AR (AR side). Direct-to-cash or
// an indeterminate/missing offset → false (stay flag-only; never double-post).
export function paymentNeedsGLMovement(bill, side, { apCode, accruedCode, arCode } = {}) {
  const offset = bill && bill.secondary_gl_code;
  if (!offset) return false;
  if (side === "ar") return offset === arCode;
  return offset === apCode || offset === accruedCode;
}

// Build the invoice-shaped object to feed persistJournalEntry for the payment, or
// null if no GL movement is needed. Always a balanced 2-line entry: the bill's
// liability/receivable offset on one leg, Cash on the other, for the bill amount.
// `debit_credit:"debit"` means the primary (gl_code) is debited and the secondary
// is credited — matching persistJournalEntry's line construction.
export function buildPaymentEntry(bill, side, opts = {}) {
  const { apCode, accruedCode, arCode, cashCode, cashName, date, billDbId } = opts;
  if (!paymentNeedsGLMovement(bill, side, { apCode, accruedCode, arCode })) return null;
  const amount = num(bill.amount);
  if (amount <= 0) return null;
  if (!cashCode) return null;        // can't post a cash movement without a cash account

  const offset = bill.secondary_gl_code;
  const offsetName = bill.secondary_gl_name || String(offset);
  const vendor = bill.vendor || (side === "ar" ? "Customer" : "Vendor");
  const base = {
    vendor, amount, date,
    source: "manual",          // normalizes to a valid CHECK source; tagged via import_metadata
    payment_status: null,      // the payment JE is a balance-sheet movement, not itself a payable
    _paymentKind: side === "ar" ? PAYMENT_KINDS.ar : PAYMENT_KINDS.ap,
    _paymentForId: billDbId != null ? String(billDbId) : null,
  };

  if (side === "ar") {
    // Dr Cash / Cr Accounts Receivable
    return {
      ...base, gl_code: cashCode, gl_name: cashName, debit_credit: "debit",
      secondary_gl_code: offset, secondary_gl_name: offsetName,
      description: `Collection – ${vendor}`,
    };
  }
  // AP: Dr <AP|Accrued liability> / Cr Cash
  return {
    ...base, gl_code: offset, gl_name: offsetName, debit_credit: "debit",
    secondary_gl_code: cashCode, secondary_gl_name: cashName,
    description: `Payment – ${vendor}`,
  };
}

// The two GL lines the entry expands to (matches persistJournalEntry), for tests
// asserting the entry is balanced and hits the right accounts.
export function paymentEntryLines(entry) {
  if (!entry) return [];
  const a = num(entry.amount);
  const isDebit = entry.debit_credit !== "credit";
  return isDebit
    ? [{ code: entry.gl_code, debit: a, credit: 0 }, { code: entry.secondary_gl_code, debit: 0, credit: a }]
    : [{ code: entry.gl_code, debit: 0, credit: a }, { code: entry.secondary_gl_code, debit: a, credit: 0 }];
}

// Signed effect of a set of entry-lines on one account's GL balance, normal-balance
// aware. `liability` (AP/Accrued) and asset/expense differ in sign on debit. Used by
// tests to prove paying actually reduces the AP balance.
export function glBalanceEffect(lines, code, { normal = "debit" } = {}) {
  let bal = 0;
  for (const l of lines || []) {
    if (l.code !== code) continue;
    const delta = num(l.debit) - num(l.credit);          // debit-positive
    bal += normal === "credit" ? -delta : delta;          // liabilities/equity/revenue: credit-normal
  }
  return Math.round(bal * 100) / 100;
}
