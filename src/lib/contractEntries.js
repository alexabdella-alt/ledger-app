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
import { addMonthsClampedYMD, addDaysYMD } from "./format.js";

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// ★ C720 — HOW OFTEN THE PAYMENT IS MADE. `payment_amount` was read as MONTHLY whatever the
// contract said: a $12,000/year subscription booked $144,000 of expense, and a $6,000/quarter
// lease three times its cash. The monthly equivalent of the stated payment; null = one payment for
// the whole term (spread over it). Unknown words are read as monthly, as before.
export function monthlyFactor(freq) {
  const f = String(freq || "monthly").toLowerCase().replace(/[^a-z]/g, "");
  if (/^(weekly|week)$/.test(f)) return 52 / 12;
  if (/^(biweekly|fortnightly|everytwoweeks)$/.test(f)) return 26 / 12;
  if (/^(semimonthly|twiceamonth)$/.test(f)) return 2;
  if (/^(quarterly|quarter|everythreemonths)$/.test(f)) return 1 / 3;
  if (/^(semiannual|semiannually|biannual|biannually|halfyearly|everysixmonths)$/.test(f)) return 1 / 6;
  if (/^(annual|annually|yearly|year|peryear)$/.test(f)) return 1 / 12;
  if (/^(onetime|once|upfront|single|lumpsum)$/.test(f)) return null;
  return 1;
}
// ★ C720 — WHOLE MONTHS from the first day to the last, inclusive of the last (Jan 1–Dec 31 is 12;
// Jan 15–Jan 14 next year is 12). Was days ÷ 30.44 on UTC-parsed dates.
export function termMonths(startYmd, endYmd) {
  const m1 = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(startYmd || "")), endNext = addDaysYMD(String(endYmd || "").slice(0, 10), 1);
  const m2 = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(endNext || ""));
  if (!m1 || !m2) return 0;
  const months = (+m2[1] - +m1[1]) * 12 + (+m2[2] - +m1[2]) + (+m2[3] - +m1[3]) / 30.44;
  return Math.max(0, Math.round(months));
}
// The last day of service month i (0-based) — the date its entry carries. Was the FIRST day of the
// NEXT month, so a January–December contract's last twelfth landed in the following year.
const monthEnd = (start, i) => addDaysYMD(addMonthsClampedYMD(start, i + 1), -1);
const MAX_MONTHS = 360;   // a 30-year schedule is the longest generated; longer terms are cut and said

export function planContractEntries({ contract = {}, rc, rn, today, defaultIbr = 0.06 } = {}) {
  const DEFAULT_IBR = defaultIbr;
  const todayLocal = () => today;
  let leaseTermMonths = Number(contract.lease_term_months) || 0;
  if (!leaseTermMonths && contract.start_date && contract.end_date) leaseTermMonths = termMonths(contract.start_date, contract.end_date);
  const factor = monthlyFactor(contract.payment_frequency);
  const rawPayment = parseFloat(contract.payment_amount) || 0;
  // the monthly equivalent of what is paid (one payment for the term → spread over it)
  const monthlyOf = (term) => factor == null ? (term > 0 ? rawPayment / term : 0) : rawPayment * factor;

  const monthlyEntries = [];

  if (contract.contract_type === "lease") {
    const ibr = contract.discount_rate_used || DEFAULT_IBR;
    if (leaseTermMonths && !contract.lease_term_months) contract.lease_term_months = leaseTermMonths;
    const term = Math.min(leaseTermMonths, MAX_MONTHS);
    const monthlyPayment = r2(monthlyOf(term));

    // ALWAYS compute with JS — never use AI arithmetic
    const asc842 = (term > 0 && monthlyPayment > 0) ? calcASC842(monthlyPayment, term, ibr) : null;

    if (asc842) {
      // ★ C720 — the cents. Each month's principal is rounded, and the LAST absorbs the difference, so
      // the liability and the right-of-use asset both end at exactly zero (they were a cent off).
      const rou = r2(asc842.rouAsset);
      const principals = asc842.schedule.map((row) => r2(row.principal));
      principals[principals.length - 1] = r2(rou - principals.slice(0, -1).reduce((a, b) => a + b, 0));
      const current = r2(principals.slice(0, 12).reduce((a, b) => a + b, 0));
      const noncurrent = r2(rou - current);

      contract.rou_asset_value = rou;
      contract.lease_liability_current = current;
      contract.lease_liability_noncurrent = noncurrent;
      contract.monthly_straight_line_expense = monthlyPayment;

      const day1 = [
        { account_code:rc("rou_asset"), account_name:rn("rou_asset"), debit: rou, credit: 0 },
        { account_code:rc("lease_liability_current"), account_name:rn("lease_liability_current"), debit: 0, credit: current },
        ...(noncurrent > 0 ? [{ account_code:rc("lease_liability_noncurrent"), account_name:rn("lease_liability_noncurrent"), debit: 0, credit: noncurrent }] : []),
      ];
      const memo = `ASC 842-20-30: PV of ${term} × $${monthlyPayment} @ ${(ibr*100).toFixed(2)}% IBR (monthly compounding). Current = principal reduction months 1-12 ($${current.toLocaleString()}), NOT gross cash.`;
      if (contract.journal_entries?.[0]) { contract.journal_entries[0].lines = day1; contract.journal_entries[0].memo = memo; }
      else contract.journal_entries = [{ date: contract.start_date || todayLocal(), description: "Lease commencement — ASC 842 initial recognition", memo, lines: day1 }];

      // ★ C720 — THE NEXT TWELVE MONTHS ARE ALWAYS "CURRENT". Every month's principal came off the
      // current liability and nothing ever moved in from long-term, so from month 13 the current
      // liability went NEGATIVE while long-term never fell. Each month now moves the principal that
      // has just entered the twelve-month window (month k+12's) from long-term to current.
      const reclass = (k) => {
        const p = principals[k + 12];
        return p > 0 ? [
          { account_code:rc("lease_liability_noncurrent"), account_name:rn("lease_liability_noncurrent"), debit: p, credit: 0 },
          { account_code:rc("lease_liability_current"), account_name:rn("lease_liability_current"), debit: 0, credit: p },
        ] : [];
      };
      const finance = !(contract.lease_type === "operating" || !contract.lease_type);
      const amortEach = r2(rou / term);
      principals.forEach((principal, i) => {
        const dateStr = monthEnd(contract.start_date || todayLocal(), i);
        const interest = r2(monthlyPayment - principal);   // so the payment entry balances exactly
        const balanceAfter = r2(rou - principals.slice(0, i + 1).reduce((a, b) => a + b, 0));
        if (!finance) {
          // Entry A: P&L — Operating Lease Expense (straight-line = cash payment for level payments)
          monthlyEntries.push({
            date: dateStr,
            description: `Operating lease payment — Month ${i + 1}`,
            memo: `ASC 842-20: SL expense $${monthlyPayment.toFixed(2)}. Interest component $${interest.toFixed(2)}, principal $${principal.toFixed(2)}. Liability balance after: $${balanceAfter}`,
            lines: [
              { account_code:rc("operating_lease_expense"), account_name:rn("operating_lease_expense"), debit: monthlyPayment, credit: 0 },
              { account_code:rc("cash"), account_name:rn("cash"), debit: 0, credit: monthlyPayment },
            ]
          });
          // Entry B: Balance sheet — non-cash liability reduction and ROU amortization
          if (principal > 0.004) {
            monthlyEntries.push({
              date: dateStr,
              description: `Lease liability & ROU amortization — Month ${i + 1}`,
              memo: `ASC 842-20: Non-cash. Principal reduction of liability = $${principal.toFixed(2)}. ROU asset decreases by same amount.`,
              lines: [
                { account_code:rc("lease_liability_current"), account_name:rn("lease_liability_current"), debit: principal, credit: 0 },
                { account_code:rc("rou_asset"), account_name:rn("rou_asset"), debit: 0, credit: principal },
                ...reclass(i),
              ]
            });
          }
        } else {
          // ★ C720 — the last month's amortization is what is left, so the asset nets to zero exactly
          const rouAmort = i === principals.length - 1 ? r2(rou - amortEach * (principals.length - 1)) : amortEach;
          monthlyEntries.push({
            date: dateStr,
            description: `Finance lease payment — Month ${i + 1}`,
            memo: `ASC 842-20: Interest $${interest.toFixed(2)} (liability × monthly rate), principal $${principal.toFixed(2)}`,
            lines: [
              { account_code:rc("interest_expense"), account_name:rn("interest_expense"), debit: interest, credit: 0 },
              { account_code:rc("lease_liability_current"), account_name:rn("lease_liability_current"), debit: principal, credit: 0 },
              { account_code:rc("cash"), account_name:rn("cash"), debit: 0, credit: monthlyPayment },
              ...reclass(i),
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
    } else {
      console.warn(`calcASC842 skipped: term=${leaseTermMonths}, payment=${monthlyPayment}`);
    }
  } else if (contract.contract_type !== "lease" && contract.start_date && contract.end_date && contract.payment_amount) {
    // ★ C720 — the whole term (was capped at 60 months, leaving the rest in deferred revenue or
    // prepaid forever), at the monthly equivalent of what is paid, the last month taking the cents.
    const months = Math.min(termMonths(contract.start_date, contract.end_date), MAX_MONTHS);
    const total = r2(monthlyOf(months) * months);
    const each = months > 0 ? r2(total / months) : 0;
    for (let i = 0; i < months; i++) {
      const dateStr = monthEnd(contract.start_date, i);
      const amt = i === months - 1 ? r2(total - each * (months - 1)) : each;
      if (!(amt > 0)) continue;
      if (contract.contract_type === "subscription_paid") {
        monthlyEntries.push({ date: dateStr, description: `Subscription expense — Month ${i+1}`, memo: "Monthly amortization of prepaid",
          lines: [{ account_code:rc("technology_software"), account_name:rn("technology_software"), debit:amt, credit:0 }, { account_code:rc("prepaid_expenses"), account_name:rn("prepaid_expenses"), debit:0, credit:amt }]});
      } else if (contract.contract_type === "revenue_contract") {
        monthlyEntries.push({ date: dateStr, description: `Revenue recognition — Month ${i+1}`, memo: "ASC 606: Performance obligation satisfied",
          lines: [{ account_code:rc("deferred_revenue"), account_name:rn("deferred_revenue"), debit:amt, credit:0 }, { account_code:rc("service_revenue"), account_name:rn("service_revenue"), debit:0, credit:amt }]});
      }
    }
  }
  return { contract, monthlyEntries, leaseTermMonths };
}
