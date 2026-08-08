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

// ── C196(1) — OUTSTANDING-CHAIN AWARENESS IN THE SORT-OUT LIST ───────────────
// THE headline O85 failure: Reconcile's "Things we need to sort out" offered
// **Accept & add** for a bank line that was actually a prior period's outstanding check
// CLEARING. One human click on a product suggestion produced the program's first wrong
// ledger entry (a duplicate expense). The pipeline already knows better (C187) — this
// surface just never asked it. Copy is a tested constant so the moment reads as an
// explanation, not a task.
export function outstandingClearedCopy({ date = null, amount = null } = {}) {
  const when = date ? fmtDate(date) : null;
  const amt = amount != null ? fmtMoney(Math.abs(Number(amount) || 0)) : null;
  return `This is the ${amt ? amt + " " : ""}check you wrote${when ? ` on ${when}` : ""} — it just cleared ✓`;
}
export const MATCH_EXISTING_ACTION_LABEL = "Match to your existing entry";

// ── C196(3) — WHOLE-STATEMENT COUNTERS ───────────────────────────────────────
// Live: after a 21-line statement ran, the tiles read "Total transactions 5" — the
// RESIDUE, not what happened. The counters must describe the whole statement, because
// that sentence is the one moment the client sees the machine's entire contribution.
export function statementSummaryCopy({ total = 0, handled = 0, needInput = 0 } = {}) {
  const t = Math.max(0, Number(total) || 0);
  const h = Math.max(0, Number(handled) || 0);
  const n = Math.max(0, Number(needInput) || 0);
  if (!t) return "No transactions on this statement";
  const parts = [`${t} transaction${t === 1 ? "" : "s"}`];
  if (h) parts.push(`${h} handled automatically`);
  // Zero must never render as "0 need review" (or "1 need review" — the plural bug).
  if (n) parts.push(`${n} need${n === 1 ? "s" : ""} your input`);
  else if (h) parts.push("nothing needs your input ✓");
  return parts.join(" · ");
}

// ── C198·3b — THE BANK IMPORT TOAST TELLS THE ALREADY-HAVE TRUTH ─────────────
// Live O86: re-uploading a statement whose every line was already booked announced
// "21 transactions imported — 0 need review". Nothing was imported; all 21 were
// deduped. Same class as the C198·2b queue-line fix, one surface over — a tile
// reporting the work it MEANT to do rather than the work it did. The pipeline path
// already says this properly ("Everything on this statement was already in your
// books ✓"); this is the manual path saying the same thing.
//
// Also keeps the "0 need review" plural bug out (cf. statementSummaryCopy). Pure.
export function bankImportToastCopy({ total = 0, alreadyBooked = 0, needReview = 0 } = {}) {
  const t = Math.max(0, Number(total) || 0);
  const a = Math.min(t, Math.max(0, Number(alreadyBooked) || 0));
  const n = Math.max(0, Number(needReview) || 0);
  if (!t) return "No transactions found on that statement.";
  if (a === t) {
    return t === 1
      ? "That transaction was already in your books ✓ — nothing added."
      : `All ${t} transactions were already in your books ✓ — nothing added.`;
  }
  const added = t - a;
  const parts = [`${added} transaction${added === 1 ? "" : "s"} imported`];
  if (a) parts.push(`${a} already in your books`);
  parts.push(n ? `${n} need${n === 1 ? "s" : ""} review` : "nothing needs review ✓");
  return parts.join(" · ");
}

// ── C196(6) / C198·3b(c) — REVIEW OPENS ON THE FIRST UNSIGNED MONTH ──────────
// C196(6) fixed the picker opening on the CURRENT calendar month, but keyed the
// answer to months WITH ACTIVITY. O86 (c) caught the rest of the bug live: after
// June was signed off the picker opened on AUGUST, because July had nothing booked
// and so was never a candidate — the reviewer was walked silently past a period
// nobody attested.
//
// The rule is calendar, not activity: the next month to review is the earliest
// month NOT signed off, counting months as a continuous sequence. A quiet month is
// still a month someone has to attest — "nothing happened" is a finding, and only a
// human can say it. Walking the sequence (rather than jumping to latest-signed + 1)
// also means a GAP in sign-offs lands on the gap instead of stepping over it.
//
// Never returns a month later than `fallback` (the caller's current month) — with
// everything attested there is nothing to review and we stay put rather than
// sending the reviewer into a month that hasn't happened yet. Pure.
const nextMonthKey = (ym) => {
  const [y, m] = String(ym).split("-").map(Number);
  return m >= 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

export function firstUnsignedMonth({ months = [], signoffs = [], fallback = null } = {}) {
  const signed = new Set((signoffs || []).filter(s => s && !s.revoked_at).map(s => String(s.period)));
  const activity = [...new Set((months || []).filter(Boolean).map(String))].sort();
  const signedList = [...signed].sort();
  if (!activity.length && !signedList.length) return fallback || null;

  // Walk from the start of the books (or the first attested month, whichever is
  // earlier) to one month past the last month we know anything about.
  const start = [activity[0], signedList[0]].filter(Boolean).sort()[0];
  const lastKnown = [activity[activity.length - 1], signedList[signedList.length - 1]].filter(Boolean).sort().pop();
  const limit = nextMonthKey(lastKnown);
  for (let m = start; m <= limit; m = nextMonthKey(m)) {
    if (!signed.has(m)) return fallback && m > fallback ? fallback : m;
  }
  return fallback || null;
}
