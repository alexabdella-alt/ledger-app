// ─────────────────────────────────────────────────────────────────────────────
// Bank-reconciliation books-set — GL-CASH derived (CLAUDE.md §9 / §12).
//
// A bank statement only ever shows CASH movements, so the "books side" that gets
// matched against statement lines must be exactly the entries that HIT the
// reconciled cash/bank account — derived from GL cash-account participation, not
// from a `type`/P&L flag. An accrual bill (Dr Expense / Cr A/P) moves no cash and
// must NOT be in the set; its later payment (Dr A/P / Cr Cash) must. Each entry
// appears ONCE, at its cash-leg amount, signed by the cash-leg direction
// (cash DEBITED = money in +, cash CREDITED = money out −).
//
// Works on the flattened `invoices` rows (src/lib/ledger flattenJournalEntries):
//   simple 2-line entry → one row, cash may be the primary (`gl_code`) or the
//     offset (`secondary_gl_code`) leg.
//   multi-line entry    → one row per leg (id `<jeId>_<i>`); ONLY the row whose
//     own `gl_code` is cash is the cash leg (a multi-line row's `secondary_gl_code`
//     points at the entry's primary offset, which is often — but isn't — cash).
// ─────────────────────────────────────────────────────────────────────────────
import { isLiveEntry } from "./reports.js";

const isMultiLegRow = (i) => String(i && i.id != null ? i.id : "").includes("_");

// Normalize the reconciled-account cash code(s) to a string Set. Accepts a single
// code, an array, or a Set.
function codeSet(cashCodes) {
  if (cashCodes == null) return new Set();
  const arr = cashCodes instanceof Set ? [...cashCodes] : Array.isArray(cashCodes) ? cashCodes : [cashCodes];
  return new Set(arr.filter(c => c != null).map(String));
}

// Does this flattened row's CASH leg touch the reconciled account?
export function touchesCashAccount(i, cashCodes) {
  const codes = codeSet(cashCodes);
  if (!codes.size || !i) return false;
  const glIsCash = i.gl_code != null && codes.has(String(i.gl_code));
  if (isMultiLegRow(i)) return glIsCash;                                   // multi-line: only the actual cash leg
  return glIsCash || (i.secondary_gl_code != null && codes.has(String(i.secondary_gl_code)));
}

// Signed cash movement for the reconciled account: + when the cash account is
// DEBITED (money into the bank), − when CREDITED (money out). Amount is the
// cash-leg amount (== `amount` for a simple 2-line entry and for a multi-line
// cash-leg row, both balanced at that value).
export function cashLegSigned(i, cashCodes) {
  const codes = codeSet(cashCodes);
  const amt = Math.abs(Number(i && i.amount) || 0);
  const primaryIsCash = i && i.gl_code != null && codes.has(String(i.gl_code));
  const primaryIsDebit = i && i.debit_credit === "debit";
  // Cash is either the primary leg (its debit/credit IS the cash direction) or the
  // offset leg (the opposite of the primary's direction).
  const cashDebited = primaryIsCash ? primaryIsDebit : !primaryIsDebit;
  return cashDebited ? amt : -amt;
}

// The reconciliation books-set: live cash-touching entries in [from, to].
// Accrual bills / uncollected AR invoices (no cash leg) are excluded by construction.
export function reconBooksSet(invoices, { cashCodes, from, to } = {}) {
  const codes = codeSet(cashCodes);
  return (invoices || []).filter(i =>
    isLiveEntry(i) &&
    i.date && (!from || i.date >= from) && (!to || i.date <= to) &&
    touchesCashAccount(i, codes)
  );
}
