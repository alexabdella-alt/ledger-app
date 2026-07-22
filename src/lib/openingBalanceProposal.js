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
export function normalizeBankParse(parsed) {
  if (Array.isArray(parsed)) return { transactions: parsed, statedOpening: null, statedPeriodStart: null };
  if (parsed && typeof parsed === "object") {
    return {
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      statedOpening: parsed.opening_balance != null ? parsed.opening_balance : null,
      statedPeriodStart: parsed.period_start || null,
    };
  }
  return { transactions: [], statedOpening: null, statedPeriodStart: null };
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
export function deriveStatementOpening({ transactions = [], statedOpening = null, statedPeriodStart = null, tolerance = 0.02 } = {}) {
  const txns = (transactions || [])
    .filter((t) => t && t.date)
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const first = txns[0] || null;

  let derived = null;
  if (first && isNum(first.balance) && isNum(first.amount)) {
    derived = r2(Number(first.balance) - Number(first.amount));
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
    const net = txns.reduce((s, t) => s + (isNum(t.amount) ? Number(t.amount) : 0), 0);
    endingBalance = r2(openingBalance + net);
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
