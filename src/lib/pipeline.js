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
import { matchOutstandingClears } from "./outstandingItems.js";

// Line-shape normalizers — tolerate BOTH the persisted row (line_date, ai_confidence,
// status='already_booked') and the in-memory parsed line (date, confidence, already_booked).
const isAlreadyBooked = (l) => !!(l && (l.already_booked === true || l.status === "already_booked"));
const confOf = (l) => { const c = l && (l.confidence != null ? l.confidence : l.ai_confidence); return c == null ? null : Number(c); };
const needsReviewOf = (l) => !!(l && l.needs_review);
const dateOf = (l) => (l && (l.date || l.line_date)) || null;
const glOf = (l) => (l && (l.gl_code || l.ai_gl_code)) || null;
// The stable line id (matches makeException's lineId) — used by the exhaustiveness invariant.
// C191: _stmtLineId (the DB uuid stamped at persist time) comes FIRST — it is the identity the
// executor writes against (bank_statement_lines.id). `id` (the parse-time in-memory txn id) is
// only a fallback for pure-test inputs that were never persisted. MUST stay aligned with
// makeException below (the invariant compares the two).
const idOf = (l) => (l && (l._stmtLineId != null ? l._stmtLineId : (l.id != null ? l.id : null)));

function makeException(line, reason, extra = {}) {
  return {
    // C191 — the DB uuid FIRST (see idOf): the executor persists exceptions with
    // .eq("id", lineId) against bank_statement_lines, so a parse-time local id matched zero
    // rows and every planner exception silently vanished (the live five-pending-lines bug).
    lineId: line && (line._stmtLineId != null ? line._stmtLineId : (line.id != null ? line.id : null)),
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
  invoices = [],               // reserved for the downstream matcher (not used to PARTITION here)
  signoffs = [],
  reconciliations = [],        // to skip re-reconciling an already-reconciled month
  openItems = [],              // reserved for the downstream matcher (not used to PARTITION here)
  outstandingCandidates = [],  // C187 — prior periods' uncleared items (priorOutstandingCandidates)
  thresholds = {},
  statement = {},
  cashCode = null,
} = {}) {
  const floor = thresholds.autoBookFloor != null ? Number(thresholds.autoBookFloor) : DEFAULT_AUTO_BOOK_FLOOR;

  // Partition ORDER (C187): already_booked → OUTSTANDING CLEAR → signed_period → confidence.
  // An outstanding match is a CLEAR even if the line's AI confidence is low — an exact-amount
  // match to an explicitly-recorded outstanding item is stronger evidence than the categorizer's
  // opinion, and NO booking occurs (so no miscategorization risk).
  const alreadyBooked = [];
  const forMatch = [];
  for (const line of (lines || [])) {
    if (isAlreadyBooked(line)) alreadyBooked.push(line);   // already in the books — untouched
    else forMatch.push(line);
  }
  // Outstanding clears come BEFORE signed_period/confidence: clearing an existing entry can't
  // change a signed month's totals (nothing books) and beats a low-confidence categorization.
  const { clears: clearsOutstanding, remainingLines, stillOutstanding } = matchOutstandingClears(forMatch, outstandingCandidates);

  const toBook = [];
  const exceptions = [];
  for (const line of remainingLines) {
    const signedP = signedPeriodForDate(dateOf(line), signoffs, { source: line && line.source });
    if (signedP) { exceptions.push(makeException(line, "signed_period", { period: signedP })); continue; }
    const c = confOf(line);
    // The DEAD-ZONE close (C190): anything BELOW the auto-book floor is a low_confidence
    // exception — regardless of whether it cleared any ask floor. There is NO "pending, routed
    // nowhere" state; a line either books (>= floor) or surfaces as an exception. (Confidence
    // recalibration is Tier 1 #5 — this only makes the sub-floor band VISIBLE, not smarter.)
    if (needsReviewOf(line) || c == null || c < floor) { exceptions.push(makeException(line, "low_confidence")); continue; }
    toBook.push(line);
  }

  // EXHAUSTIVENESS INVARIANT (C190): every input line MUST land in exactly one bucket —
  // already_booked / clearsOutstanding / toBook / exceptions. If any line escaped the partition
  // (a future dead zone), sweep it into exceptions as low_confidence so it can NEVER sit
  // invisible-and-pending. In the current partition this is a no-op; it's the guarantee that
  // matters — the counts below MUST sum to the input length.
  const accounted = new Set([
    ...alreadyBooked.map(idOf),
    ...clearsOutstanding.map((c) => idOf(c.line)),
    ...toBook.map(idOf),
    ...exceptions.map((e) => e.lineId),
  ].map((id) => String(id)));
  for (const line of (lines || [])) {
    const key = String(idOf(line));
    if (!accounted.has(key)) { exceptions.push(makeException(line, "low_confidence")); accounted.add(key); }
  }

  // ── Reconciliation decision — NEVER create a second reconciliation for an attested or
  //    already-reconciled month; conclude "already matched" instead. ──
  const period = periodOf(statement && (statement.period_end || statement.period_start));
  let attempt = true, reason = "ready";
  if (!period) { attempt = false; reason = "no_period"; }
  else if (isPeriodSignedOff(signoffs, period)) { attempt = false; reason = "period_signed_off"; }
  else if (reconciliationCoversPeriod(reconciliations, period)) { attempt = false; reason = "already_reconciled"; }
  // "already matched": nothing happened AND the month is attested/reconciled (the Feb-re-upload case).
  const conclusion = (!attempt && toBook.length === 0 && exceptions.length === 0 && clearsOutstanding.length === 0) ? "already_matched" : null;

  return {
    toBook,
    toMatch: toBook,               // the same set feeds the existing matcher downstream (clears vs direct-book split)
    exceptions,
    alreadyBooked,
    clearsOutstanding,             // C187 — [{ line, candidate }] a prior entry clearing on this statement (book NOTHING)
    stillOutstanding,              // C187 — candidates not yet cleared → carry forward into this recon's outstanding_books
    reconciliation: { attempt, reason, conclusion },
    period,
    counts: {
      total: (lines || []).length,
      toBook: toBook.length,
      exceptions: exceptions.length,
      alreadyBooked: alreadyBooked.length,
      clearsOutstanding: clearsOutstanding.length,
    },
    // The partition is exhaustive by construction (the sweep above guarantees it) — true iff the
    // four buckets sum to the input length. Callers/tests can assert on this.
    exhaustive: (alreadyBooked.length + clearsOutstanding.length + toBook.length + exceptions.length) === (lines || []).length,
  };
}

// The statement's final status after a pipeline run — 'complete' iff nothing needs a human
// (no line exceptions AND no balance discrepancy), else 'attention'. Pure, so the executor and
// tests agree. (Line exceptions include the closed dead-zone band, so a sub-floor line correctly
// drives the statement to 'attention'.)
export function pipelineStatementStatus({ exceptionCount = 0, balanceDiscrepancy = null } = {}) {
  return (Number(exceptionCount) === 0 && !balanceDiscrepancy) ? "complete" : "attention";
}
