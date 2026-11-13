// ─────────────────────────────────────────────────────────────────────────────
// O83 — DERIVE THE CASH OPENING BALANCE FROM AN UPLOADED BANK STATEMENT.
//
// A bank statement STATES the opening balance ("Opening balance 01/01/2026:
// $12,483.27") and the period start — a number the client already handed us on a
// document. Booking only the transaction lines leaves the balance sheet's cash at
// net-change-only. This module extracts that opening (stated AND/OR derived from the
// first transaction's running balance), decides whether to PROPOSE it (never silently
// book), flags a discrepancy when an opening already exists and disagrees, and keys
// re-uploads for idempotency. All pure + unit-tested; the app confirms + books through
// the canonical opening-balance write path.
// ─────────────────────────────────────────────────────────────────────────────

import { fmtMoney } from "./format";
import { glIsRevenue } from "./gl";

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const isNum = (n) => n != null && n !== "" && !isNaN(Number(n));
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "2026-01-01" → "January 2026" (or "January" when only day-in-month matters). Null on garbage.
export function periodMonthLabel(ymd, { withYear = true } = {}) {
  const m = /^(\d{4})-(\d{2})/.exec(String(ymd || ""));
  if (!m) return null;
  const name = MONTHS[Number(m[2]) - 1];
  if (!name) return null;
  return withYear ? `${name} ${m[1]}` : name;
}

// Normalize a bank-statement PARSE RESPONSE into a stable shape, tolerant of BOTH the
// object form `{ opening_balance, period_start, transactions[] }` (current parse-bank-*
// profiles, since 165b075) AND a bare transactions array (legacy / pre-165b075). ONE
// normalizer so every consumer — Bank Import AND Reconcile (and any future one) — reads
// the parse the same way and can't go stale on the shape again (the O83 reconcile-PDF
// regression: ReconView still did `Array.isArray(arr) ? arr : []` and rejected the object).
// C198·3c (ii) — `statedPeriodEnd` joins it. The parse profiles have always asked for
// `period_start` and never for `period_end`, so the one side of the period the July
// drive got WRONG was the one side nobody was reading off the document. A statement
// that carries neither still normalizes to nulls and the caller falls back to the span.
export function normalizeBankParse(parsed) {
  if (Array.isArray(parsed)) return { transactions: parsed, statedOpening: null, statedPeriodStart: null, statedPeriodEnd: null };
  if (parsed && typeof parsed === "object") {
    return {
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      statedOpening: parsed.opening_balance != null ? parsed.opening_balance : null,
      statedPeriodStart: parsed.period_start || null,
      statedPeriodEnd: parsed.period_end || null,
    };
  }
  return { transactions: [], statedOpening: null, statedPeriodStart: null, statedPeriodEnd: null };
}

// Derive the statement's opening balance + period start from parsed data.
//   • STATED   — the summary figure the statement prints (statedOpening/statedPeriodStart).
//   • DERIVED  — the first transaction's running balance MINUS that transaction's signed
//                amount (balance_before = balance_after − amount).
// When BOTH exist they're cross-checked: a disagreement beyond tolerance sets `mismatch`
// (we surface the stated figure but flag it — we never silently guess). Also returns the
// statement ENDING balance (last running balance, else opening + net) — the reconciliation
// target for the period, written to the account's current_balance on confirm (O83). Returns
// { ok, openingBalance, endingBalance, periodStart, stated, derived, mismatch, source }.
// ★ C607 — TWO WAYS THE STATEMENT'S OWN BALANCES WERE MISREAD (review finding K4):
//  (1) ORDER. Rows were sorted by date only, and a stable sort keeps same-day rows in FILE
//      order — so for a newest-first export the "first" row of the first day was really that
//      day's LAST, and opening = its balance − its amount was off by everything else that day.
//      The order that makes the running balances add up is the true one; with no balances to
//      tell, the file's own date direction decides.
//  (2) SIGN. One reading instruction lets amounts come back unsigned with a debit/credit
//      type. "balance − amount" on an unsigned withdrawal ADDED it. Amounts are signed by type.
// C670 (review) — on a card's OWN statement a row typed "payment" is the payoff, money ONTO the
// card; the PDF reader's prompt lists "payments" as money out, which is the bank's reading.
export function signedStatementAmount(t = {}, { liability = false } = {}) {
  const n = Number(t.amount);
  if (!Number.isFinite(n)) return null;
  const ty = String(t.type || "").toLowerCase();
  if (liability && /payment/.test(ty)) return Math.abs(n);
  if (/debit|withdraw|expense|payment|fee|charge/.test(ty)) return -Math.abs(n);
  if (/credit|deposit|revenue|income|refund/.test(ty)) return Math.abs(n);
  return n;
}

function chainScore(rows, sign = 1) {
  let ok = 0;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1], cur = rows[i];
    const amt = signedStatementAmount(cur, { liability: sign === -1 });
    if (isNum(prev.balance) && isNum(cur.balance) && amt != null && Math.abs(Number(cur.balance) - (Number(prev.balance) + sign * amt)) <= 0.02) ok++;
  }
  return ok;
}

export function chronologicalStatementRows(transactions = [], { liability = false } = {}) {
  const sign = liability ? -1 : 1;   // C668 — a card's balance moves the other way
  const dated = (transactions || []).filter((t) => t && t.date);
  const byDate = (rows) => rows.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const asGiven = byDate(dated);
  const reversed = byDate(dated.slice().reverse());
  const a = chainScore(asGiven, sign), b = chainScore(reversed, sign);
  if (a !== b) return a > b ? asGiven : reversed;
  const newestFirst = dated.length > 1 && String(dated[0].date) > String(dated[dated.length - 1].date);
  return newestFirst ? reversed : asGiven;
}

// ★ C668 — `liability`: a credit card's or loan's statement counts what is OWED, so a purchase
// (money out) RAISES the balance and a payment lowers it — the opposite of a bank account. With
// bank signs a $100 charge taking the owed balance to $1,100 derived an opening of $1,200 (not
// $1,000), the ending was computed the wrong way, and a correct printed opening read as a mismatch.
export function deriveStatementOpening({ transactions = [], statedOpening = null, statedPeriodStart = null, tolerance = 0.02, liability = false } = {}) {
  const txns = chronologicalStatementRows(transactions, { liability });
  const first = txns[0] || null;
  const sign = liability ? -1 : 1;   // how one row's signed (in +, out −) amount moves the balance

  let derived = null;
  const firstAmt = first ? signedStatementAmount(first, { liability }) : null;
  if (first && isNum(first.balance) && firstAmt != null) {
    derived = r2(Number(first.balance) - sign * firstAmt);
  }
  const stated = isNum(statedOpening) ? r2(statedOpening) : null;
  const periodStart = statedPeriodStart || (first ? String(first.date) : null);

  let openingBalance = stated != null ? stated : derived;
  let mismatch = false;
  if (stated != null && derived != null) {
    mismatch = Math.abs(stated - derived) > tolerance;
    openingBalance = stated; // prefer the printed figure; `mismatch` flags disagreement
  }
  // Statement ENDING balance = the last row's running balance; else opening + net change.
  const last = txns[txns.length - 1] || null;
  let endingBalance = null;
  if (last && isNum(last.balance)) endingBalance = r2(Number(last.balance));
  else if (openingBalance != null) {
    const net = txns.reduce((s, t) => s + (signedStatementAmount(t, { liability }) ?? 0), 0);
    endingBalance = r2(openingBalance + sign * net);
  }
  const source = stated != null && derived != null ? "both" : stated != null ? "stated" : derived != null ? "derived" : "none";
  return { ok: openingBalance != null && !!periodStart, openingBalance, endingBalance, periodStart, stated, derived, mismatch, source };
}

// Should we PROPOSE an opening balance for this account? Only when:
//   • no opening balance is already recorded for it, AND
//   • no booked entry predates the statement period start (books earlier than the
//     statement mean this statement is NOT the true starting position).
export function shouldProposeOpening({ hasOpeningForAccount = false, earliestBookedDate = null, periodStart = null } = {}) {
  if (hasOpeningForAccount) return false;
  if (!periodStart) return false;
  if (earliestBookedDate && String(earliestBookedDate) < String(periodStart)) return false;
  return true;
}

// On confirming a statement opening for an account, decide how its current_balance (the
// reconciliation target, CLAUDE.md §12) should move — writing the statement ENDING balance
// marks the seeded account as adopted so the checklist ticks. Guards:
//   • "set"      — current balance is 0/blank (the pristine seed) → adopt the ending balance.
//   • "keep"     — user already typed a balance that matches the ending → no-op.
//   • "mismatch" — user typed a DIFFERENT non-zero balance → LEAVE it (a reconciliation
//                  question, never a silent auto-adjust); carries the diff to surface.
//   • "none"     — no usable ending balance.
export function resolveAdoptedBalance({ existingBalance = 0, endingBalance = null } = {}, { tolerance = 0.02 } = {}) {
  if (!isNum(endingBalance)) return { action: "none", value: Number(existingBalance) || 0 };
  const existing = Number(existingBalance) || 0;
  const ending = r2(endingBalance);
  if (existing === 0) return { action: "set", value: ending };
  if (Math.abs(existing - ending) > tolerance) return { action: "mismatch", value: existing, ending, diff: r2(existing - ending) };
  return { action: "keep", value: existing };
}

// A DISCREPANCY: an opening already exists and the statement disagrees with it. We never
// auto-adjust — this is a genuine "something's wrong" signal for the trust layer. Returns
// { mismatch, diff, statedOpening, recordedOpening }.
export function openingDiscrepancy({ statedOpening = null, recordedOpening = null, tolerance = 0.02 } = {}) {
  if (!isNum(statedOpening) || !isNum(recordedOpening)) return { mismatch: false, diff: 0, statedOpening: null, recordedOpening: null };
  const diff = r2(Number(statedOpening) - Number(recordedOpening));
  return { mismatch: Math.abs(diff) > tolerance, diff, statedOpening: r2(statedOpening), recordedOpening: r2(recordedOpening) };
}

// Direction of a PARSED bank line relative to cash: "in" (deposit/money-in) or "out"
// (withdrawal/money-out). Prefers an explicit type, then the sign of the amount.
export function bankLineDirection(t = {}) {
  if (t.direction === "in" || t.direction === "out") return t.direction;
  if (typeof t.money_in === "boolean") return t.money_in ? "in" : "out";   // C630 — the statement's own direction
  if (t.type === "revenue") return "in";
  if (t.type === "expense") return "out";
  const n = Number(t.amount);
  return Number.isFinite(n) && n < 0 ? "out" : "in";
}

// Direction of an ALREADY-BOOKED (flattened) entry, from which leg the cash/offset account
// sits on: cash DEBITED → money in; cash CREDITED → money out. Symmetric with
// bankLineDirection so the two sides of the dedup agree. Works whether cash is the primary
// leg (rare) or the offset leg (the usual Dr Expense / Cr Cash · Dr Cash / Cr Revenue).
export function bookedLineDirection(inv = {}, offsetCode = null) {
  const primaryDebit = inv.debit_credit ? inv.debit_credit === "debit" : !glIsRevenue(inv.gl_code);
  const cashIsPrimary = offsetCode != null && String(inv.gl_code) === String(offsetCode);
  const cashDebited = cashIsPrimary ? primaryDebit : !primaryDebit;   // offset leg is opposite the primary
  return cashDebited ? "in" : "out";
}

// Content dedup key for a bank line (idempotent re-upload). STABLE fields ONLY —
// date + magnitude + direction. Deliberately NO vendor/description text: at booking time
// the memo is rewritten ("Toast POS – TOAST POS DEPOSIT 0113") and the vendor is cleaned,
// while a re-parse yields the RAW memo ("TOAST POS DEPOSIT 011326") and the GL can even be
// re-categorized run-to-run — so ANY text/GL-based key is asymmetric and never collides
// (the O83 production double-book: markAlreadyBooked matched 0 of 20). Direction keeps a
// deposit from deduping against an equal-amount withdrawal on the same day.
//
// KNOWN TRADE-OFF: two GENUINELY DISTINCT transactions with the same date + amount +
// direction on the same account collide on this key. Failure mode is bounded and safe:
// a real new line can arrive FLAGGED already-booked (defaulted UNCHECKED in the review —
// visible and one click to re-check), never a silent double-post. Chosen deliberately as
// safer than the text-based key that double-booked in production. (Multiset counting means
// N genuine same-key lines still surface N times across upload + re-upload.)
export function bankTxnKey({ date, amount, direction } = {}) {
  const d = String(date || "").slice(0, 10);
  const amt = r2(Math.abs(Number(amount) || 0));
  const dir = direction === "in" || direction === "out" ? direction : "out";
  return `${d}|${amt}|${dir}`;
}

// Mark parsed lines ALREADY booked to this account (so re-uploading never double-books).
// Keys on date + amount + direction against live ledger rows whose cash/card offset is this
// account. Multiset-aware: two identical real charges need two existing bookings to both be
// marked. Returns lines with `already_booked` set (the caller defaults those UNCHECKED, so a
// genuine same-day/same-amount coincidence is recoverable — never a silent delete).
export function markAlreadyBooked(parsedLines = [], existingInvoices = [], { offsetCode = null } = {}) {
  const seen = new Map();
  for (const inv of existingInvoices || []) {
    if (!inv || inv.status === "voided" || inv.status === "deleted" || inv.deleted_at) continue;
    if (offsetCode && String(inv.secondary_gl_code) !== String(offsetCode) && String(inv.gl_code) !== String(offsetCode)) continue;
    const k = bankTxnKey({ date: inv.date, amount: inv.amount, direction: bookedLineDirection(inv, offsetCode) });
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  return (parsedLines || []).map((t) => {
    const k = bankTxnKey({ date: t.date, amount: t.amount, direction: bankLineDirection(t) });
    const n = seen.get(k) || 0;
    if (n > 0) { seen.set(k, n - 1); return { ...t, already_booked: true }; }
    return { ...t, already_booked: false };
  });
}

// The plain-language proposal copy (owner-facing — jargon-checked by cardinalPrinciple).
// e.g. "Your statement shows you started January 2026 with $12,483.27 in checking. We'll
// record that as your starting balance — look right?"
export function openingProposalCopy({ openingBalance, periodStart, accountName = "checking" } = {}) {
  const money = fmtMoney(openingBalance);
  const when = periodMonthLabel(periodStart, { withYear: true });
  const acct = String(accountName || "checking").trim() || "checking";
  const lead = when ? `Your statement shows you started ${when}` : `Your statement shows you started`;
  return `${lead} with ${money} in ${acct}. We'll record that as your starting balance — look right?`;
}
