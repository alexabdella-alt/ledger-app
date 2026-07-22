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
import { isLiveEntry, glAccountBalance } from "./reports.js";

const isMultiLegRow = (i) => String(i && i.id != null ? i.id : "").includes("_");
const r2c = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ── Completion guard (O83 follow-up 2) — pure, so the UI gate + tests agree ──────
// A reconciliation may only be COMPLETED with a VERIFIED bank ending balance: a real
// non-zero balance, OR a genuinely-empty/closed account ($0) the user explicitly
// confirmed. A blank balance is never verified. This is what gets written to
// `statement_balance_verified` and what the sign-off gate (reconciliationCoversPeriod)
// keys on, so an unverified-$0 phantom can't be produced or counted.
export function statementBalanceVerified(statementBalance, emptyConfirmed = false) {
  if (statementBalance == null || String(statementBalance).trim() === "") return false;   // nothing entered
  const n = parseFloat(statementBalance);
  if (!Number.isFinite(n)) return false;
  return n !== 0 || emptyConfirmed === true;
}

// Can this reconciliation be completed? Books must balance to the statement (diff ≈ 0)
// AND the ending balance must be verified. Pure predicate shared by the button + guard.
export function canCompleteReconciliation({ statementBalance = "", difference = 0, emptyConfirmed = false } = {}) {
  const balanced = Math.abs(Number(difference) || 0) < 0.005;
  return balanced && statementBalanceVerified(statementBalance, emptyConfirmed);
}

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

// ── O83 completion-bar math (BUG 1 + BUG 2) ──────────────────────────────────
// An opening-balance entry dated at/before the period start IS the cleared starting
// position — the statement's own opening-balance line. It is NEVER an "outstanding" book
// item and NEVER shown in the sort-out queue (voiding it would destroy the derived opening).
export function isOpeningPositionRow(row, periodStart) {
  if (!row || row.source !== "opening_balance") return false;
  if (!periodStart) return true;
  return String(row.date || "") <= String(periodStart);
}

// "What your books show" — the GL cash balance of the reconciled account(s) AS OF the
// statement period end, straight from the ledger (glAccountBalance, the canonical §12 cash
// source). Includes the opening position + all cleared/uncleared activity. INDEPENDENT of
// any user input — this is the comparison target the bank ending balance is checked against
// (the BUG-1 fix: the old code derived it from the bank input, `stmtNum − diff`).
export function reconBooksBalance(invoices, cashCodes, { asOf = null } = {}) {
  const codes = codeSet(cashCodes);
  let bal = 0;
  for (const c of codes) bal += glAccountBalance(String(c), invoices, { asOf });
  return r2c(bal);
}

// The GENUINELY-OUTSTANDING book items (in the books, not yet cleared the bank): live
// cash rows that are NOT matched to a bank line, NOT user-hidden, and NOT the opening
// position. This is exactly what the sort-out queue should show — never the opening entry.
export function reconOutstandingBooks(booksRows = [], { matchedBookIds = new Set(), hidden = {}, periodStart = null } = {}) {
  return (booksRows || []).filter((b) =>
    b && !matchedBookIds.has(b.id) && !hidden[b.id] && !isOpeningPositionRow(b, periodStart)
  );
}

// Standard bank-reconciliation difference — RECONCILED when it is $0.00:
//   difference = bank_ending_balance
//              + Σ(outstanding book items, cash-leg signed)   [in the books, not yet on the bank]
//              − Σ(unmatched bank lines, signed)              [on the bank, not yet in the books]
//              − books_balance (GL cash at period end)
// Because books_balance already includes every booked cash movement (incl. the opening
// position + any outstanding items), a clean period where every bank line matched and the
// only difference is timing nets to 0 once the true bank ending balance is entered.
export function reconcileDifference({ statementBalance = 0, booksBalance = 0, outstandingSigned = 0, unmatchedBankSigned = 0 } = {}) {
  return r2c((Number(statementBalance) || 0) + (Number(outstandingSigned) || 0) - (Number(unmatchedBankSigned) || 0) - (Number(booksBalance) || 0));
}
