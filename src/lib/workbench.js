// ─────────────────────────────────────────────────────────────────────────────
// C195 — WORKBENCH HONESTY SWEEP (§11 O84 Part 2 item 4). Pure helpers + the
// owner-facing copy constants, so every surface can tell the truth and the tests
// can pin the wording.
//
// STANDING DIRECTIVE (§11): every owner-facing surface assumes ZERO accounting
// knowledge. Not merely "no jargon" — no assumed CONCEPTS. A sentence that requires
// the reader to already know what "outstanding", "uncleared" or "reconciled" means
// has failed, even if every individual word is plain.
// ─────────────────────────────────────────────────────────────────────────────
import { fmtMoney, fmtDate } from "./format.js";

// ── (6) TRUTHFUL BOOKING TOAST ───────────────────────────────────────────────
// Live: booking 5 lines reported "0 / 0" — the toast led with the MATCHER breakdown
// (deterministic 0, AI 0), which is honest about matching and silent about the thing
// the user just did. Lead with what actually happened; mention matching only when
// matching actually happened.
export function bookingToastCopy({ cleared = 0, booked = 0, payrollMatched = 0, payrollFlagged = 0, needReview = 0, failed = 0, deterministic = 0, llm = 0 } = {}) {
  const n = (v) => Math.max(0, Number(v) || 0);
  const [c, b, pm, pf, nr, f, det, ai] = [cleared, booked, payrollMatched, payrollFlagged, needReview, failed, deterministic, llm].map(n);
  const parts = [];
  if (b) parts.push(`${b} transaction${b === 1 ? "" : "s"} recorded`);
  if (c) parts.push(`${c} bill payment${c === 1 ? "" : "s"} matched`);
  if (pm) parts.push(`${pm} payroll line${pm === 1 ? "" : "s"} already covered by your payroll report`);
  if (pf) parts.push(`${pf} payroll line${pf === 1 ? "" : "s"} recorded but needing detail`);
  if (nr) parts.push(`${nr} still need${nr === 1 ? "s" : ""} a look`);
  if (f) parts.push(`${f} didn't save — please retry ${f === 1 ? "it" : "them"}`);
  // Nothing happened at all — say THAT, don't print zeros.
  if (!parts.length) return "Nothing new to record — everything here was already in your books ✓";
  const head = parts.join(" · ");
  // The matcher breakdown is diagnostic; include it only when it carries information.
  const tail = (det + ai) > 0 ? ` (matched automatically: ${det}${ai ? `, with AI help: ${ai}` : ""})` : "";
  return `${head}${tail}${f ? "" : " ✓"}`;
}

// ── (2) RECON COMPLETION RETIRES COVERED STATEMENTS ──────────────────────────
// After a VERIFIED completion (the C194 gate), any statement for the same account whose
// period falls INSIDE the reconciled period and which is still flagged 'attention' with
// NO unresolved excepted lines has been answered by the reconciliation — retire it so its
// card stops outliving the signed-off month. Pure: returns the ids to mark 'complete'.
export function statementsCoveredByReconciliation(statements = [], { accountId = null, periodStart = null, periodEnd = null, exceptedStatementIds = [] } = {}) {
  const withExceptions = new Set((exceptedStatementIds || []).map(String));
  const sameAccount = (s) => (accountId && accountId !== "manual")
    ? String(s.bank_account_id) === String(accountId)
    : true;
  return (statements || []).filter((s) => {
    if (!s || String(s.status) !== "attention") return false;
    if (withExceptions.has(String(s.id))) return false;              // real unresolved work → keep it
    if (!sameAccount(s)) return false;
    const ps = String(s.period_start || ""), pe = String(s.period_end || "");
    if (!ps && !pe) return false;
    return (!periodStart || !ps || ps >= String(periodStart)) && (!periodEnd || !pe || pe <= String(periodEnd));
  }).map((s) => String(s.id));
}

// ── (7) INTAKE ORPHAN AUTO-RESOLVE ───────────────────────────────────────────
// A duplicate upload of a file we ALREADY recorded nagged as "received but never recorded"
// for an hour. `document_intake` already carries content_hash (migration 047), so a dropped
// intake row whose hash matches a recorded document is explained — resolve it instead of
// surfacing it. Pure: returns the intake ids to retire (+ the matched document id).
export function autoResolvableIntake({ droppedRows = [], recordedHashes = [] } = {}) {
  const known = new Map();
  for (const d of (recordedHashes || [])) {
    if (d && d.content_hash) known.set(String(d.content_hash), String(d.id));
  }
  const out = [];
  for (const r of (droppedRows || [])) {
    const h = r && r.content_hash;
    if (!h) continue;
    const docId = known.get(String(h));
    if (docId) out.push({ intakeId: String(r.id), documentId: docId });
  }
  return out;
}

// ── (8) PLAIN-LANGUAGE COPY — the "knows nothing" bar ────────────────────────
// The outstanding-check moment. Explains the CONCEPT (not just avoiding jargon): what
// happened, why the two numbers differ, that it's normal, and what we'll do next.
export function outstandingCheckCopy({ amount = 0, date = null } = {}) {
  const amt = fmtMoney(Math.abs(Number(amount) || 0));
  const when = date ? fmtDate(date) : null;
  return `You wrote a ${amt} check${when ? ` on ${when}` : ""} that nobody has cashed yet. `
    + `Your books already count it as spent; the bank doesn't know about it yet. `
    + `That's normal — confirm it and we'll carry it forward.`;
}

// The opening-balance gap. When known uncashed items fully explain it, this is NOT an alarm —
// say so and show the ✓. Only a genuinely unexplained gap gets the "worth a look" framing.
export function openingMismatchCopy({ diff = 0, explainedCount = 0, accountName = "your account" } = {}) {
  const gap = fmtMoney(Math.abs(Number(diff) || 0));
  const n = Math.max(0, Number(explainedCount) || 0);
  if (n > 0) {
    return `${accountName}: the ${gap} difference is explained by ${n} check${n === 1 ? "" : "s"} you wrote that ${n === 1 ? "hasn't" : "haven't"} been cashed yet ✓`;
  }
  return `${accountName}: your records and this statement start ${gap} apart, and we can't yet explain why. `
    + `Nothing has been changed — your accountant should take a look.`;
}

// Statement-exception card copy — what the automatic run could not finish, said so a
// reader with zero accounting knowledge understands what to DO.
export const STATEMENT_EXCEPTION_COPY = {
  low_confidence: "We weren't sure what this payment was for, so we left it for your accountant to label.",
  signed_period: "This is dated in a month your accountant has already closed, so we didn't add it. They'll decide where it belongs.",
  unmatched: "We couldn't tell which bill this payment was for, so we left it for your accountant to connect.",
  book_failed: "We couldn't record this one automatically. Nothing was saved for it — your accountant will add it.",
  balance_discrepancy: "The ending amount on this statement doesn't match your books yet. Nothing was changed — your accountant will sort out the difference.",
};
export function statementExceptionCopy(reason) {
  return STATEMENT_EXCEPTION_COPY[reason] || "This one needs your accountant's eyes before we record it.";
}
