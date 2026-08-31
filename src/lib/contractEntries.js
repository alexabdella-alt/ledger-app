// ─────────────────────────────────────────────────────────────────────────────
// A CONTRACT BECOMES A SCHEDULE OF ENTRIES — the accounting, on its own.
//
// `O89`, third slice. `handleContractFile` was 188 lines with four awaits and **no planner
// calls**: after the model extracts the terms, ~130 lines of ASC 842 and ASC 606 logic built
// the Day 1 entry and every monthly entry, inline, inside the component. `calcASC842` (the
// present-value maths) was already a tested library function; **turning its schedule into
// journal entries was not**, and that is the half that decides what actually hits the books.
//
// ★★ THE PROPERTY WORTH GUARDING, AND IT WAS TRUE ONLY BY COINCIDENCE: a finance-lease month
// debits interest AND principal against a single payment credit, each ROUNDED INDEPENDENTLY.
// It balances because `calcASC842` computes `principal = payment − interest` exactly, so the
// two rounding errors mirror — **except at an exact half-cent tie, where `Math.round` sends
// both halves the same way and the entry breaks by a cent.** Float arithmetic makes that
// vanishingly rare rather than impossible, and `buildJournalEntry` REFUSES an unbalanced
// entry, so the failure mode is a lease month that silently does not post. Swept across 180
// payment/term/rate combinations by a test; recorded here so nobody "simplifies" the rounding.
//
// ★ The model's own arithmetic is overwritten, never trusted — that decision predates this
// extraction and is preserved verbatim.
//
// Pure. `rc`/`rn` resolve roles, `today` is injected; no clock, no client, no writes.
// ─────────────────────────────────────────────────────────────────────────────

import { calcASC842 } from "./gl.js";
import { addMonthsClampedYMD } from "./format.js";

export function planContractEntries({ contract = {}, rc, rn, today, defaultIbr = 0.06 } = {}) {
  const DEFAULT_IBR = defaultIbr;
  const todayLocal = () => today;
  // Calculate lease term from dates if AI didn't return it
  let leaseTermMonths = contract.lease_term_months || 0;
  if (!leaseTermMonths && contract.start_date && contract.end_date) {
    const start = new Date(contract.start_date);
    const end = new Date(contract.end_date);
    leaseTermMonths = Math.round((end - start) / (1000 * 60 * 60 * 24 * 30.44));
  }
  

  // ── GENERATE MONTHLY ENTRIES IN JS (no second API call needed) ────────
  const monthlyEntries = [];

  if (contract.contract_type === "lease") {
    const ibr = contract.discount_rate_used || DEFAULT_IBR;
    const monthlyPayment = parseFloat(contract.payment_amount) || 0;
    // Ensure we have term months — calculate from dates if missing
    if (!leaseTermMonths && contract.start_date && contract.end_date) {
      leaseTermMonths = Math.round((new Date(contract.end_date) - new Date(contract.start_date)) / (1000*60*60*24*30.44));
      contract.lease_term_months = leaseTermMonths;
    }
    

    // ALWAYS compute with JS — never use AI arithmetic
    const asc842 = (leaseTermMonths > 0 && monthlyPayment > 0)
      ? calcASC842(monthlyPayment, leaseTermMonths, ibr)
      : null;

    if (asc842) {
      
      // Override everything the AI calculated
      contract.rou_asset_value = asc842.rouAsset;
      contract.lease_liability_current = asc842.currentPortion;
      contract.lease_liability_noncurrent = asc842.nonCurrentPortion;
      contract.monthly_straight_line_expense = asc842.straightLineMonthly;
    } else {
      console.warn(`calcASC842 skipped: term=${leaseTermMonths}, payment=${monthlyPayment}`);
    }

    // ALWAYS patch Day 1 entry with correct computed values
    if (asc842) {
      if (contract.journal_entries?.[0]) {
        contract.journal_entries[0].lines = [
          { account_code:rc("rou_asset"), account_name:rn("rou_asset"), debit: asc842.rouAsset, credit: 0 },
          { account_code:rc("lease_liability_current"), account_name:rn("lease_liability_current"), debit: 0, credit: asc842.currentPortion },
          { account_code:rc("lease_liability_noncurrent"), account_name:rn("lease_liability_noncurrent"), debit: 0, credit: asc842.nonCurrentPortion },
        ];
        contract.journal_entries[0].memo = `ASC 842-20-30: PV of ${leaseTermMonths} × $${monthlyPayment} @ ${(ibr*100).toFixed(2)}% IBR (monthly compounding). Current = principal reduction months 1-12 ($${asc842.currentPortion.toLocaleString()}), NOT gross cash.`;
      } else {
        contract.journal_entries = [{
          date: contract.start_date || todayLocal(),
          description: "Lease commencement — ASC 842 initial recognition",
          memo: `ASC 842-20-30: PV of ${leaseTermMonths} × $${monthlyPayment} @ ${(ibr*100).toFixed(2)}% IBR`,
          lines: [
            { account_code:rc("rou_asset"), account_name:rn("rou_asset"), debit: asc842.rouAsset, credit: 0 },
            { account_code:rc("lease_liability_current"), account_name:rn("lease_liability_current"), debit: 0, credit: asc842.currentPortion },
            { account_code:rc("lease_liability_noncurrent"), account_name:rn("lease_liability_noncurrent"), debit: 0, credit: asc842.nonCurrentPortion },
          ]
        }];
      }
    }

    // Use pre-computed amortization schedule from calcASC842
    if (asc842) asc842.schedule.forEach((row, i) => {
      // Local-safe schedule date (CR-4/CR-5) — month-add on the YMD string, not UTC toISOString.
      const dateStr = addMonthsClampedYMD(contract.start_date || todayLocal(), i + 1);
      const principal = Math.round(row.principal * 100) / 100;
      const interest = Math.round(row.interest * 100) / 100;

      if (contract.lease_type === "operating" || !contract.lease_type) {
        // Entry A: P&L — Operating Lease Expense (straight-line = cash payment for level payments)
        monthlyEntries.push({
          date: dateStr,
          description: `Operating lease payment — Month ${i + 1}`,
          memo: `ASC 842-20: SL expense $${monthlyPayment.toFixed(2)}. Interest component $${interest.toFixed(2)}, principal $${principal.toFixed(2)}. Liability balance after: $${Math.round(row.balance * 100) / 100}`,
          lines: [
            { account_code:rc("operating_lease_expense"), account_name:rn("operating_lease_expense"), debit: parseFloat(monthlyPayment.toFixed(2)), credit: 0 },
            { account_code:rc("cash"), account_name:rn("cash"), debit: 0, credit: parseFloat(monthlyPayment.toFixed(2)) },
          ]
        });
        // Entry B: Balance sheet — non-cash liability reduction and ROU amortization
        if (principal > 0.01) {
          monthlyEntries.push({
            date: dateStr,
            description: `Lease liability & ROU amortization — Month ${i + 1}`,
            memo: `ASC 842-20: Non-cash. Principal reduction of liability = $${principal.toFixed(2)}. ROU asset decreases by same amount.`,
            lines: [
              { account_code:rc("lease_liability_current"), account_name:rn("lease_liability_current"), debit: principal, credit: 0 },
              { account_code:rc("rou_asset"), account_name:rn("rou_asset"), debit: 0, credit: principal },
            ]
          });
        }
      } else {
        // Finance lease
        const rouAmort = Math.round(asc842.rouAsset / leaseTermMonths * 100) / 100;
        monthlyEntries.push({
          date: dateStr,
          description: `Finance lease payment — Month ${i + 1}`,
          memo: `ASC 842-20: Interest $${interest.toFixed(2)} (liability × monthly rate), principal $${principal.toFixed(2)}`,
          lines: [
            { account_code:rc("interest_expense"), account_name:rn("interest_expense"), debit: interest, credit: 0 },
            { account_code:rc("lease_liability_current"), account_name:rn("lease_liability_current"), debit: principal, credit: 0 },
            { account_code:rc("cash"), account_name:rn("cash"), debit: 0, credit: parseFloat(monthlyPayment.toFixed(2)) },
          ]
        });
        monthlyEntries.push({
          date: dateStr,
          description: `ROU asset amortization — Month ${i + 1}`,
          memo: `ASC 842-20: Finance lease — straight-line amortization of ROU asset`,
          lines: [
            { account_code:rc("rou_amortization"), account_name:rn("rou_amortization"), debit: rouAmort, credit: 0 },
            { account_code:rc("accumulated_amortization_rou"), account_name:rn("accumulated_amortization_rou"), debit: 0, credit: rouAmort },
          ]
        });
      }
    });
  } else if (contract.contract_type !== "lease" && contract.start_date && contract.end_date && contract.payment_amount) {
    // For non-lease: generate simple monthly entries in JS too
    const start = new Date(contract.start_date);
    const end = new Date(contract.end_date);
    const months = Math.round((end - start) / (1000 * 60 * 60 * 24 * 30.44));
    for (let i = 0; i < Math.min(months, 60); i++) {
      // Local-safe schedule date (CR-4/CR-5) — month-add on the YMD string, not UTC toISOString.
      const dateStr = addMonthsClampedYMD(contract.start_date || todayLocal(), i + 1);
      if (contract.contract_type === "subscription_paid") {
        monthlyEntries.push({ date: dateStr, description: `Subscription expense — Month ${i+1}`, memo: "Monthly amortization of prepaid",
          lines: [{ account_code:rc("technology_software"), account_name:rn("technology_software"), debit:parseFloat(contract.payment_amount), credit:0 }, { account_code:rc("prepaid_expenses"), account_name:rn("prepaid_expenses"), debit:0, credit:parseFloat(contract.payment_amount) }]});
      } else if (contract.contract_type === "revenue_contract") {
        monthlyEntries.push({ date: dateStr, description: `Revenue recognition — Month ${i+1}`, memo: "ASC 606: Performance obligation satisfied",
          lines: [{ account_code:rc("deferred_revenue"), account_name:rn("deferred_revenue"), debit:parseFloat(contract.payment_amount), credit:0 }, { account_code:rc("service_revenue"), account_name:rn("service_revenue"), debit:0, credit:parseFloat(contract.payment_amount) }]});
      }
    }
  }
  return { contract, monthlyEntries, leaseTermMonths };
}
