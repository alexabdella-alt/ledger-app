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
// C499 — TWO ROW SHAPES ESTABLISH A RECEIVABLE OR PAYABLE, AND ONLY ONE WAS RECOGNISED.
// A simple bill flattens to one row whose OFFSET is A/P (Dr Expense / Cr A/P). A multi-line
// bill or a taxed invoice expands to several rows, and the one that represents it (C498) is
// its LEG row — the row whose PRIMARY account IS A/P (a credit, the bill's whole amount) or
// A/R (a debit, the whole receivable). Handed a leg row, this returned false, `buildPaymentEntry`
// returned null, and `markBillPaid` flipped the flag with NO cash movement: every taxed
// invoice collected through a bank match read "collected" while A/R kept the full amount and
// the deposit never reached the books. A debit to A/P or a credit to A/R is a settlement's
// own leg and is never a bill.
export function settlementLegOf(bill, side, { apCode, accruedCode, arCode } = {}) {
  if (!bill) return null;
  const eq = (a, b) => a != null && b != null && String(a) === String(b);
  const wants = side === "ar" ? [arCode] : [apCode, accruedCode];
  const sec = bill.secondary_gl_code;
  const expanded = String(bill.id ?? "").includes("_");
  // The offset shape: a simple row, or — on an expanded invoice — the revenue row flatten
  // stamps `ar_amount` on. Any other expanded row with A/R or A/P as its offset (a tax line,
  // one expense line of a multi-line bill) carries only PART of the balance and is refused.
  const offsetShape = !expanded || (side === "ar" && bill.ar_amount != null);
  if (offsetShape && sec != null && wants.some((c) => eq(c, sec))) {
    const amount = side === "ar" && bill.ar_amount != null ? bill.ar_amount : bill.amount;
    return { code: sec, name: bill.secondary_gl_name || String(sec), amount: num(amount) };
  }
  const pri = bill.gl_code;
  const establishes = side === "ar" ? bill.debit_credit === "debit" : bill.debit_credit === "credit";
  if (expanded && establishes && pri != null && wants.some((c) => eq(c, pri))) {
    return { code: pri, name: bill.gl_name || String(pri), amount: num(bill.amount) };
  }
  return null;
}
export function paymentNeedsGLMovement(bill, side, codes = {}) {
  return settlementLegOf(bill, side, codes) != null;
}

// Build the invoice-shaped object to feed persistJournalEntry for the payment, or
// null if no GL movement is needed. Always a balanced 2-line entry: the bill's
// liability/receivable offset on one leg, Cash on the other, for the bill amount.
// `debit_credit:"debit"` means the primary (gl_code) is debited and the secondary
// is credited — matching persistJournalEntry's line construction.
export function buildPaymentEntry(bill, side, opts = {}) {
  const { apCode, accruedCode, arCode, cashCode, cashName, date, billDbId } = opts;
  const leg = settlementLegOf(bill, side, { apCode, accruedCode, arCode });
  if (!leg) return null;
  // Collect/pay the FULL balance owed. For a taxed AR invoice that's the incl-tax A/R
  // (ar_amount on the revenue row, or the A/R leg row's own amount), not the ex-tax
  // revenue — so collecting clears A/R to zero and never strands the tax. The sales-tax
  // liability (2350) was recorded at invoice time and is untouched here.
  const amount = leg.amount;
  if (amount <= 0) return null;
  if (!cashCode) return null;        // can't post a cash movement without a cash account

  const offset = leg.code;
  const offsetName = leg.name;
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
