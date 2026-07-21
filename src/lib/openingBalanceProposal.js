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

// Derive the statement's opening balance + period start from parsed data.
//   • STATED   — the summary figure the statement prints (statedOpening/statedPeriodStart).
//   • DERIVED  — the first transaction's running balance MINUS that transaction's signed
//                amount (balance_before = balance_after − amount).
// When BOTH exist they're cross-checked: a disagreement beyond tolerance sets `mismatch`
// (we surface the stated figure but flag it — we never silently guess). Returns
// { ok, openingBalance, periodStart, stated, derived, mismatch, source }.
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
  const source = stated != null && derived != null ? "both" : stated != null ? "stated" : derived != null ? "derived" : "none";
  return { ok: openingBalance != null && !!periodStart, openingBalance, periodStart, stated, derived, mismatch, source };
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

// A DISCREPANCY: an opening already exists and the statement disagrees with it. We never
// auto-adjust — this is a genuine "something's wrong" signal for the trust layer. Returns
// { mismatch, diff, statedOpening, recordedOpening }.
export function openingDiscrepancy({ statedOpening = null, recordedOpening = null, tolerance = 0.02 } = {}) {
  if (!isNum(statedOpening) || !isNum(recordedOpening)) return { mismatch: false, diff: 0, statedOpening: null, recordedOpening: null };
  const diff = r2(Number(statedOpening) - Number(recordedOpening));
  return { mismatch: Math.abs(diff) > tolerance, diff, statedOpening: r2(statedOpening), recordedOpening: r2(recordedOpening) };
}

// Content dedup key for a bank line (idempotent re-upload). Date + magnitude + a
// normalized description slice — NOT the volatile per-upload id.
export function bankTxnKey(t = {}) {
  const date = String(t.date || "").slice(0, 10);
  const amt = r2(Math.abs(Number(t.amount) || 0));
  const desc = String(t.description || t.vendor || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 40);
  return `${date}|${amt}|${desc}`;
}

// Mark parsed lines that are ALREADY booked to this account (so re-uploading a statement
// never double-books). Matches on content key against live ledger rows whose cash/card
// offset is this account. Multiset-aware: two identical real charges both need two existing
// bookings to both be marked. Returns lines with `already_booked` set.
export function markAlreadyBooked(parsedLines = [], existingInvoices = [], { offsetCode = null } = {}) {
  const seen = new Map();
  for (const inv of existingInvoices || []) {
    if (!inv || inv.status === "voided" || inv.status === "deleted" || inv.deleted_at) continue;
    if (offsetCode && String(inv.secondary_gl_code) !== String(offsetCode) && String(inv.gl_code) !== String(offsetCode)) continue;
    const k = bankTxnKey({ date: inv.date, amount: inv.amount, description: inv.vendor || inv.description });
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  return (parsedLines || []).map((t) => {
    const k = bankTxnKey(t);
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
