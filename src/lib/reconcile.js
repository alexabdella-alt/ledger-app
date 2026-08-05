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

// The STILL-UNDECIDED book items (the "sort out" queue): live cash rows NOT matched to a
// bank line, NOT yet marked outstanding, and NOT the opening position. These are unexplained
// until the user matches them or marks them outstanding — so they do NOT net the difference
// (they keep it open until resolved). Never the opening entry.
export function reconOutstandingBooks(booksRows = [], { matchedBookIds = new Set(), hidden = {}, periodStart = null } = {}) {
  return (booksRows || []).filter((b) =>
    b && !matchedBookIds.has(b.id) && !hidden[b.id] && !isOpeningPositionRow(b, periodStart)
  );
}

// The book items the user EXPLICITLY marked "hasn't hit the bank yet" — an outstanding check /
// deposit-in-transit. Unlike the undecided sort-out queue above, THESE are decided and MUST net
// in reconcileDifference (bank + Σ(outstanding, cash-signed) − books). Keyed on the SAME `marked`
// map the queue passes as `hidden`, so the sets are exact complements: every book row is either
// matched, marked-outstanding, or still-to-sort-out — never two of those, never double-counted.
// (O83 Feb: the marking was fed ONLY to `hidden`, which dropped the item from the sum entirely —
// it read as "matched" in the count yet the difference never netted it, blocking completion.)
export function reconMarkedOutstanding(booksRows = [], { matchedBookIds = new Set(), marked = {}, periodStart = null } = {}) {
  return (booksRows || []).filter((b) =>
    b && !!marked[b.id] && !matchedBookIds.has(b.id) && !isOpeningPositionRow(b, periodStart)
  );
}

// The stale OPEN reconciliation rows that completing THIS one supersedes: same account (by id
// when present, else by name) + same period, excluding the row being completed. Deleting these on
// completion prevents a period being BOTH Complete (in History) AND resumable after a mid-session
// save failure stranded a phantom autosave (O83 Bug 2 — the operator completed February twice this
// way). Pure so the rule is testable; the completion flow deletes exactly this set by id.
export function supersedableOpenReconciliations(recs = [], { accountId = null, accountName = null, periodStart = null, periodEnd = null, keepId = null } = {}) {
  const sameAccount = (r) => (accountId && accountId !== "manual")
    ? String(r.account_id) === String(accountId)
    : String(r.account_name || "") === String(accountName || "");
  return (recs || []).filter((r) =>
    r && String(r.status) === "open" &&
    String(r.id) !== String(keepId) &&
    String(r.period_start) === String(periodStart) &&
    String(r.period_end) === String(periodEnd) &&
    sameAccount(r)
  );
}

// ── C194 — RECONCILIATION COMPLETION GATE ────────────────────────────────────
// The worst O84 finding: ReconView showed "Your books match your bank ✓" for a
// reconciliation that DID NOT EXIST in the database — the completion write was wrapped
// in a try whose catch only console.warn'd, then the success screen, the ✓ toast and the
// `reconciliation_completed` audit event all ran UNCONDITIONALLY.
//
// A reconciliation is complete ONLY when a row was RE-SELECTED and observed at
// status='complete'. Everything downstream (cleared stamps, bank balance, supersede,
// audit, ✓, the done screen) is gated on this verdict. Pure, so the UI and the tests agree.
export function reconCompletionGate({ rid = null, error = null, row = null } = {}) {
  if (!rid) return { proceed: false, reason: "no_row" };            // the write never produced an id
  if (error) return { proceed: false, reason: "db_error" };          // the verify read itself failed
  if (!row) return { proceed: false, reason: "zero_rows" };          // THE live bug: nothing there
  if (String(row.status) !== "complete") return { proceed: false, reason: "not_complete" };
  return { proceed: true, reason: null };
}

// Which row id the completion must target. The ordering-dependent seam behind the live
// failure: `saveNow` records the new id in BOTH a synchronous ref and React state, but the
// completion path read STATE only — so if the autosave insert was still in flight (or its
// setState hadn't flushed) the completion saw null and INSERTED A SECOND ROW. Prefer the
// synchronous ref; fall back to state. Pure.
export function resolveReconRowId({ stateId = null, refId = null } = {}) {
  return refId || stateId || null;
}

// Owner-facing copy for the two outcomes — plain language, no jargon, and the failure text
// says explicitly that NOTHING was saved (the user must never think a period is locked in
// when the database disagrees).
export const RECON_COMPLETE_SUCCESS_COPY = "Your books match your bank ✓";
export const RECON_COMPLETE_FAILURE_COPY = "We couldn't save this reconciliation — nothing was locked in. Your matches are still here.";
export function reconCompletionCopy(gate) {
  return (gate && gate.proceed) ? RECON_COMPLETE_SUCCESS_COPY : RECON_COMPLETE_FAILURE_COPY;
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
