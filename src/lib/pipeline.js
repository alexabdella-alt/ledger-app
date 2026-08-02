// ─────────────────────────────────────────────────────────────────────────────
// C186 — North Star Phase 1-B: the automatic clean-path pipeline PLANNER.
//
// PURE partition only — no I/O, no booking, no matching. Given a persisted
// statement's lines (+ the ledger, sign-offs, existing reconciliations), decide
// which lines are safe to auto-book, which are EXCEPTIONS that must never book
// silently, and whether to even attempt a reconciliation. The App executor runs
// the plan through the EXISTING booking/matching/reconcile paths (§9/§12) — this
// file adds ZERO new accounting logic; it only sorts.
//
// A line is auto-book-safe ONLY when it is: not already booked, confident enough
// (>= autoBookFloor and not flagged needs_review), and NOT dated inside a period
// a reviewer already signed off (C182). Everything else is an exception with a
// machine reason the CPA Review queue surfaces in plain language.
// ─────────────────────────────────────────────────────────────────────────────
import { signedPeriodForDate, periodOf } from "./signedPeriod.js";
import { isPeriodSignedOff } from "./signoff.js";
import { reconciliationCoversPeriod } from "./controlTotals.js";

// Line-shape normalizers — tolerate BOTH the persisted row (line_date, ai_confidence,
// status='already_booked') and the in-memory parsed line (date, confidence, already_booked).
const isAlreadyBooked = (l) => !!(l && (l.already_booked === true || l.status === "already_booked"));
const confOf = (l) => { const c = l && (l.confidence != null ? l.confidence : l.ai_confidence); return c == null ? null : Number(c); };
const needsReviewOf = (l) => !!(l && l.needs_review);
const dateOf = (l) => (l && (l.date || l.line_date)) || null;
const glOf = (l) => (l && (l.gl_code || l.ai_gl_code)) || null;

function makeException(line, reason, extra = {}) {
  return {
    lineId: line && (line.id != null ? line.id : (line._stmtLineId != null ? line._stmtLineId : null)),
    fingerprint: (line && line.fingerprint) || null,
    reason,                                    // 'signed_period' | 'low_confidence' (executor adds 'unmatched'/'book_failed'/'balance_discrepancy')
    date: dateOf(line),
    amount: Number(line && line.amount) || 0,
    vendor: (line && line.vendor) || null,
    confidence: confOf(line),
    gl_code: glOf(line),
    ...extra,
  };
}

// The default auto-book confidence floor (mirrors AI_CONFIDENCE_AUTO_BOOK); the caller passes
// the real constant via thresholds.autoBookFloor.
export const DEFAULT_AUTO_BOOK_FLOOR = 85;

export function planStatementPipeline({
  lines = [],
  invoices = [],          // reserved for the downstream matcher (not used to PARTITION here)
  signoffs = [],
  reconciliations = [],   // to skip re-reconciling an already-reconciled month
  openItems = [],         // reserved for the downstream matcher (not used to PARTITION here)
  thresholds = {},
  statement = {},
  cashCode = null,
} = {}) {
  const floor = thresholds.autoBookFloor != null ? Number(thresholds.autoBookFloor) : DEFAULT_AUTO_BOOK_FLOOR;

  const toBook = [];
  const exceptions = [];
  const alreadyBooked = [];

  for (const line of (lines || [])) {
    if (isAlreadyBooked(line)) { alreadyBooked.push(line); continue; }     // already in the books — untouched
    const signedP = signedPeriodForDate(dateOf(line), signoffs, { source: line && line.source });
    if (signedP) { exceptions.push(makeException(line, "signed_period", { period: signedP })); continue; }
    const c = confOf(line);
    if (needsReviewOf(line) || c == null || c < floor) { exceptions.push(makeException(line, "low_confidence")); continue; }
    toBook.push(line);
  }

  // ── Reconciliation decision — NEVER create a second reconciliation for an attested or
  //    already-reconciled month; conclude "already matched" instead. ──
  const period = periodOf(statement && (statement.period_end || statement.period_start));
  let attempt = true, reason = "ready";
  if (!period) { attempt = false; reason = "no_period"; }
  else if (isPeriodSignedOff(signoffs, period)) { attempt = false; reason = "period_signed_off"; }
  else if (reconciliationCoversPeriod(reconciliations, period)) { attempt = false; reason = "already_reconciled"; }
  // "already matched": nothing to do AND the month is attested/reconciled (the Feb-re-upload case).
  const conclusion = (!attempt && toBook.length === 0 && exceptions.length === 0) ? "already_matched" : null;

  return {
    toBook,
    toMatch: toBook,               // the same set feeds the existing matcher downstream (clears vs direct-book split)
    exceptions,
    alreadyBooked,
    reconciliation: { attempt, reason, conclusion },
    period,
    counts: {
      total: (lines || []).length,
      toBook: toBook.length,
      exceptions: exceptions.length,
      alreadyBooked: alreadyBooked.length,
    },
  };
}
