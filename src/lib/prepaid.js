// ─────────────────────────────────────────────────────────────────────────────
// Prepaid expenses (#9) — pure builders, posted through the canonical multi-line
// path. A payment for future periods is capitalized as an asset and amortized to
// expense over the coverage period (matching principle, ASC 340).
//
//   Capitalize:  Dr Prepaid Expenses (1300)  /  Cr Cash (or A/P)
//   Amortize (each period):  Dr <expense>  /  Cr Prepaid Expenses (1300)
//
// Amortization is generated UP FRONT (one posted entry per month) — the existing
// model, now deterministic: the last month absorbs the rounding remainder so the
// sum equals the capitalized amount to the cent (prepaid fully amortizes to zero,
// no stranded residual). Accounts are passed as codes; the caller resolves
// prepaid_expenses by ROLE. (A depreciation-style pending-schedule + run-on-demand
// is a possible future unification — see ROADMAP; not used here.)
// ─────────────────────────────────────────────────────────────────────────────

import { buildJournalEntry } from "./journalEntries.js";

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// Dr Prepaid Expenses / Cr offset (Cash or A/P). Null on invalid inputs.
export function buildPrepaidCapitalizeEntry({ amount, prepaidCode, offsetCode, date = null, vendor = "Vendor", description = null, memo = null, meta = null } = {}) {
  const amt = r2(amount);
  if (!(amt > 0) || !prepaidCode || !offsetCode) return null;
  return buildJournalEntry({
    lines: [
      { code: prepaidCode, debit: amt, credit: 0 },   // Dr Prepaid Expenses (asset)
      { code: offsetCode, debit: 0, credit: amt },     // Cr Cash / A/P
    ],
    date, source: "gaap_prepaid",
    description: description || `Prepaid – ${vendor}`,
    memo, meta: meta || { kind: "prepaid_capitalize" },
  });
}

// Dr <expense> / Cr Prepaid Expenses, for one period's consumed portion.
export function buildPrepaidAmortizeEntry({ amount, expenseCode, prepaidCode, date = null, description = "Prepaid amortization", memo = null, meta = null } = {}) {
  const amt = r2(amount);
  if (!(amt > 0) || !expenseCode || !prepaidCode) return null;
  return buildJournalEntry({
    lines: [
      { code: expenseCode, debit: amt, credit: 0 },   // Dr Expense (consumed)
      { code: prepaidCode, debit: 0, credit: amt },     // Cr Prepaid Expenses
    ],
    date, source: "gaap_prepaid_amort",
    description, memo, meta: meta || { kind: "prepaid_amortize" },
  });
}

// The full straight-line amortization schedule: one entry per month from startDate.
// `total` === the capitalized amount exactly (last month absorbs the remainder).
export function buildPrepaidSchedule({ total, months, startDate, expenseCode, prepaidCode, label = "Prepaid", maxMonths = 60 } = {}) {
  const base = r2(total);
  const n = Math.min(Math.max(0, Math.floor(Number(months) || 0)), maxMonths);
  if (!(base > 0) || n === 0 || !startDate || !expenseCode || !prepaidCode) {
    return { entries: [], total: 0, monthly: 0, months: 0 };
  }
  const per = r2(base / n);
  const start = new Date(String(startDate) + "T12:00:00");
  const entries = [];
  let posted = 0;
  for (let k = 0; k < n; k++) {
    const dt = new Date(start.getFullYear(), start.getMonth() + k, start.getDate());
    const isLast = k === n - 1;
    const amt = isLast ? r2(base - posted) : per;   // last month absorbs rounding
    posted = r2(posted + amt);
    entries.push(buildPrepaidAmortizeEntry({
      amount: amt, expenseCode, prepaidCode,
      date: dt.toISOString().slice(0, 10),
      description: `${label} — amortization ${k + 1}/${n}`,
      meta: { kind: "prepaid_amortize", period: k + 1, of: n },
    }));
  }
  return { entries, total: r2(posted), monthly: per, months: n };
}
