// Balance sheet accounts (1xxx assets, 2xxx liabilities, 3xxx equity) never appear on P&L.
const glIsRevenue     = (code) => typeof code === "string" && code.startsWith("4");
// Income-statement expense accounts: 5xxx COGS, 6xxx operating, 7xxx (bad debt / misc),
// 8xxx below-the-line (interest, income tax, gain/loss on disposal).
const glIsExpense     = (code) => typeof code === "string" && (code.startsWith("5") || code.startsWith("6") || code.startsWith("7") || code.startsWith("8"));

// ── ASC 842 LEASE CALCULATION — AUDIT-READY ──────────────────────────────────
// Per ASC 842-20-30-1: Lease Liability = PV of remaining lease payments
// discounted at the rate implicit in the lease, or if not determinable,
// the lessee's incremental borrowing rate (IBR).
// 
// PV Formula: PMT × (1 - (1 + r)^-n) / r  where r = monthly IBR, n = term months
// This discounts each payment individually (monthly compounding) — the only
// method that produces audit-ready numbers per ASC 842.
//
// Current Portion = PRINCIPAL REDUCTION over next 12 months (NOT cash payments)
// This is what reduces the present value of the liability, NOT gross cash paid.
// Using gross cash as current portion overstates current liabilities (common error).
//
// ROU Asset at commencement = Lease Liability (+ prepaid rent + IDC - incentives)
// For standard leases with no prepaid/incentives: ROU Asset = Lease Liability exactly.
const calcASC842 = (monthlyPayment, termMonths, annualIBR) => {
  const r = annualIBR / 12; // monthly rate (e.g. 5% annual = 0.4167%/mo)

  // Step 1: Calculate initial lease liability using PV of ordinary annuity
  // (payments at end of period — standard for operating leases)
  const leaseLiability = r > 0
    ? monthlyPayment * (1 - Math.pow(1 + r, -termMonths)) / r
    : monthlyPayment * termMonths;

  // Step 2: ROU Asset = Lease Liability at commencement
  const rouAsset = leaseLiability;

  // Step 3: Build amortization schedule to get GAAP-correct current portion
  // Current portion = total principal reduction in months 1-12
  // This is calculated by running the effective interest method month by month
  let balance = leaseLiability;
  let currentPortion = 0;
  const schedule = [];

  for (let i = 0; i < termMonths; i++) {
    const interestExpense = balance * r;
    const principalReduction = monthlyPayment - interestExpense;
    balance = Math.max(0, balance - principalReduction);
    schedule.push({ month: i + 1, interest: interestExpense, principal: principalReduction, balance });
    if (i < 12) currentPortion += principalReduction; // first 12 months = current
  }

  const nonCurrentPortion = leaseLiability - currentPortion;
  const straightLineMonthly = monthlyPayment; // for operating lease, SL expense = cash payment when payments are level

  // ★★★ THE NON-CURRENT PORTION IS THE PLUG, AND IT HAS TO BE.
  // The commencement entry is Dr ROU asset / Cr current / Cr non-current, so those three
  // figures MUST tie. Rounding each of them independently does not guarantee that: current +
  // non-current equals the liability exactly in float, but two separate roundings can land a
  // cent apart from the rounded liability. Found by sweeping 180 payment/term/rate
  // combinations — e.g. $1,500 × 24 months @ 5% produced **Dr 34,190.85 against Cr 34,190.84**.
  //
  // ★★ AND THE FAILURE MODE IS SILENCE, WHICH IS WHY IT SURVIVED: `buildJournalEntry` REFUSES
  // an unbalanced entry, so the lease commencement simply never posted — no wrong number on a
  // report, just a missing one. Making the residual absorb the rounding is both the standard
  // accounting treatment and the only version that ties by construction.
  const rl = Math.round(leaseLiability * 100) / 100;
  const rc = Math.round(currentPortion * 100) / 100;
  return {
    leaseLiability:    rl,
    rouAsset:          rl,                  // ROU asset = lease liability at commencement
    currentPortion:    rc,
    nonCurrentPortion: Math.round((rl - rc) * 100) / 100,
    straightLineMonthly: Math.round(straightLineMonthly * 100) / 100,
    schedule, // full amortization schedule for reference
  };
};
const glIsBalSheet    = (code) => typeof code === "string" && (code.startsWith("1") || code.startsWith("2") || code.startsWith("3"));
// Returns "revenue" | "expense" | null (null = balance sheet — exclude from P&L entirely)
const glPLType        = (code) => glIsRevenue(code) ? "revenue" : glIsExpense(code) ? "expense" : null;

// C536 — `accounts.category` is CHECK-constrained to five capitalised plurals. §4's numbering
// convention already decides it from the code's first digit, so a category a caller supplies is
// at most a cross-check: the model's `add_account` wrote its own word ("Expense", "asset") and the
// insert was refused. The code decides; a stated category is honoured only when it is one of the
// five and agrees with the code; otherwise the code's own.
export const ACCOUNT_CATEGORIES = ["Assets", "Liabilities", "Equity", "Revenue", "Expenses"];
export function categoryForCode(code, stated = null) {
  const c = String(code || "");
  const byCode = c.startsWith("1") ? "Assets" : c.startsWith("2") ? "Liabilities" : c.startsWith("3") ? "Equity" : c.startsWith("4") ? "Revenue" : /^[5-8]/.test(c) ? "Expenses" : null;
  const s = String(stated || "").trim().toLowerCase();
  const norm = ACCOUNT_CATEGORIES.find(k => k.toLowerCase() === s || k.toLowerCase() === s + "s" || k.toLowerCase() === s.replace(/ies$/, "y") || (s === "liability" && k === "Liabilities"));
  if (byCode) return byCode;
  return norm || "Expenses";
}
export { glIsRevenue, glIsExpense, calcASC842, glIsBalSheet, glPLType };

// ── C468 — A CORRECTION AND ITS TARGET ARE NEITHER OF THEM AN OPEN ITEM ──────────────
// A dated correction (`import_metadata.reverses`) mirrors every line of the entry it
// cancels, so it flattens as a bill-shaped row of its own — A/P leg, expense primary, no
// paid flag — and the ORIGINAL keeps its A/P leg too. Openness readers must skip both:
// the reversal because it is a cancellation, the original because `reversed_by` (stamped
// by the flatten from the live reversal) says it has been cancelled. Lives here, in the
// one module every reader already imports, so there is one definition of "not open".
export const isReversalEntry = (i) => !!(i && i.import_metadata && i.import_metadata.reverses != null && i.import_metadata.reverses !== "");
export const isCancelledOrCancelling = (i) => !!(i && (i.reversed_by || isReversalEntry(i)));

// ═════════════════════════════════════════════════════════════════════════════
// C528 — A BILL A LIVE SETTLEMENT LINKS IS NOT OPEN, WHATEVER ITS FLAG SAYS. §9's rule since
// O73: openness = "no LIVE clearing entry links this bill" (`matchableOpenItems` has read it
// that way all along); the flag is a cache that writers stamp and C466 resyncs, and every
// open LIST and total still read the flag alone. A collection whose flag write was lost
// (C466's class) left the invoice on "Money owed to you" and in `ar_tie` while the GL — and
// the matcher — knew it was cleared. The live settlements' targets, as one set; the open
// lists and totals exclude them. Only ever REMOVES from the open set (a linked live
// settlement is proof of clearing); it never adds.
// ═════════════════════════════════════════════════════════════════════════════
export const isSettlementEntry = (i) => !!(i && i.import_metadata && i.import_metadata.payment_for != null);
// ★ C599 — A REVERSED PAYMENT SETTLES NOTHING. A dated correction leaves the original payment
// POSTED and adds a reversing entry (§12 #14), so "not voided, not deleted" was not enough: a
// payment taken back still settled its bill — the bill read paid while the books said owed,
// fell off every open list, and could never be paid again (both "mark paid" and the matcher
// refused it). `reversed_by` (stamped by the flatten from the live reversal) and the reversal
// itself are excluded, the same rule the open-bill readers use (`isCancelledOrCancelling`).
export const isLiveSettlement = (i) => isSettlementEntry(i) && i.status !== "voided" && i.status !== "deleted" && !i.deleted_at && !isCancelledOrCancelling(i);
export const entryBaseOf = (i) => String(i && i.db_entry_id != null ? i.db_entry_id : String((i && i.id) ?? "").split("_")[0]);
// ★ C718 — PART-PAYMENTS. An entry's AMOUNT is what it put on account: a two-line entry's amount,
// or an expanded entry's debits (a taxed invoice's receivable; a multi-line bill's lines). A
// payment's amount is measured the same way. What has been paid toward an entry is the sum of its
// LIVE payments; it is SETTLED only when that covers its amount. "Any payment linked" used to mean
// settled, so a customer who paid $400 of $1,000 closed the whole invoice — or, refused, pushed the
// owner to book the $400 as new income while the invoice stayed owed.
export function entryAmountsByBase(invoices = []) {
  const out = new Map();
  for (const i of invoices || []) {
    if (!i) continue;
    const b = entryBaseOf(i);
    const expanded = String(i.id ?? "").includes("_");
    const add = !expanded ? (Number(i.amount) || 0) : (i.debit_credit === "debit" ? Number(i.amount) || 0 : 0);
    out.set(b, (out.get(b) || 0) + add);
  }
  return out;
}
export function paidByBase(invoices = []) {
  const amounts = entryAmountsByBase(invoices);
  const seen = new Set(), out = new Map();
  for (const i of invoices || []) {
    if (!isLiveSettlement(i)) continue;
    const b = entryBaseOf(i);
    if (seen.has(b)) continue;                       // one payment entry counts once, however many rows it flattened to
    seen.add(b);
    const target = String(i.import_metadata.payment_for);
    out.set(target, Math.round(((out.get(target) || 0) + (amounts.get(b) || 0)) * 100) / 100);
  }
  return out;
}
export function settledBases(invoices = []) {
  const amounts = entryAmountsByBase(invoices);
  const out = new Set();
  for (const [target, paid] of paidByBase(invoices)) {
    const owed = amounts.get(target);
    // an entry not in this list (not loaded) is taken as settled by its payment, as before
    if (owed == null || paid >= owed - 0.005) out.add(target);
  }
  return out;
}
// What is still owed on a part-paid entry: base → paid so far, for entries paid in part only.
export function partlyPaidBases(invoices = []) {
  const amounts = entryAmountsByBase(invoices);
  const out = new Map();
  for (const [target, paid] of paidByBase(invoices)) {
    const owed = amounts.get(target);
    if (owed != null && paid > 0.004 && paid < owed - 0.005) out.set(target, paid);
  }
  return out;
}
// A row from an open list, carrying what has been paid toward it (`_paid`) so `owedAmount` reads
// what is still owed. Rows not part-paid are returned as they are.
export function withPaidSoFar(rows = [], invoices = []) {
  const part = partlyPaidBases(invoices);
  if (!part.size) return rows;
  return (rows || []).map((r) => { const p = part.get(entryBaseOf(r)); return p ? { ...r, _paid: p } : r; });
}
