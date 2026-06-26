// ─────────────────────────────────────────────────────────────────────────────
// Accrued liabilities (#10) — a pure builder, posted through the canonical multi-line
// path. An expense INCURRED but not yet invoiced/paid is recognized when earned
// (matching principle): the cost hits the P&L now and the obligation sits as a
// liability until settled.
//
//   Accrue:  Dr <expense>  /  Cr Accrued Liabilities (2100)
//   (Settling it later is the normal AP/cash payment path — Dr 2100 / Cr Cash.)
//
// Accounts are passed as codes; the caller resolves `accrued_liabilities` by ROLE
// (never a hardcoded "2100"). Returns null on invalid inputs. Mirrors the other 17
// event builders (prepaid/payroll/revenue) and is validated by gaapInvariants #10.
// ─────────────────────────────────────────────────────────────────────────────

import { buildJournalEntry } from "./journalEntries.js";

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// Dr <expense> / Cr Accrued Liabilities (2100). Null on invalid inputs.
export function buildAccruedLiabilityEntry({ amount, expenseCode, accruedCode, date = null, vendor = "Accrual", description = null, memo = null, meta = null } = {}) {
  const amt = r2(amount);
  if (!(amt > 0) || !expenseCode || !accruedCode) return null;
  return buildJournalEntry({
    lines: [
      { code: expenseCode, debit: amt, credit: 0 },   // Dr Expense — recognized now (P&L)
      { code: accruedCode, debit: 0, credit: amt },    // Cr Accrued Liabilities (2100)
    ],
    date, source: "gaap_accrued",
    description: description || `Accrued – ${vendor}`,
    memo, meta: meta || { kind: "accrued_liability" },
  });
}
