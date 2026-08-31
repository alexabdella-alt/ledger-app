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

export { glIsRevenue, glIsExpense, calcASC842, glIsBalSheet, glPLType };
