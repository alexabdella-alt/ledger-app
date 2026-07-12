// ─────────────────────────────────────────────────────────────────────────────
// O90 — OWNER-FACING TRUST PROJECTION (CR-27). "Let the owner SEE the trust."
//
// This is NOT new computation. It is a plain-language PROJECTION of the trust data
// the CPA surface (ReviewView) already computes: O60 intake completeness, O49
// confidence flags, the O59 control totals, and the O50 sign-off. It runs the SAME
// `evaluateSignOff` three-net gate the CPA sign-off uses, so the owner view can NEVER
// disagree with the CPA view — if a net is short, the panel says so honestly, in
// business English, and never shows a false "all clear".
//
// CARDINAL PRINCIPLE (owner surface): every string here is plain business language —
// NO GL codes, no debit/credit, no "control total / reconcile / trial balance / accrual"
// jargon, no confidence %. Enforced by the cardinalPrinciple guard (scans this file's
// output) + `containsOwnerJargon`.
// ─────────────────────────────────────────────────────────────────────────────

import { evaluateSignOff } from "./controlTotals";
import { reconcileIntake, isTerminalIntake, INTAKE_STATUS } from "./documentIntake";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "2026-05" → "May 2026" (owner-facing period label). Null on a malformed period.
export function monthLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ""));
  if (!m) return null;
  const mi = Number(m[2]) - 1;
  return MONTHS[mi] ? `${MONTHS[mi]} ${m[1]}` : null;
}

const plural = (n, one, many) => (n === 1 ? one : many);

// THE PROJECTION (pure, deterministic). Same inputs the CPA gate consumes; returns the
// owner-facing status: an overall state + three plain-language lines + at most ONE gentle
// "needs you" nudge. Never shows green unless all three nets clear (evaluateSignOff.ok).
export function ownerTrustState({
  controlTotals = { failed: [], allTie: true },
  openConfidenceFlags = [],
  intakeRows = [],
  unknownDocs = [],
  reviewedThrough = null,
  now = new Date(),
} = {}) {
  // ── Completeness (O60): the SAME dropped set the sign-off gate uses. ──
  const dropped = reconcileIntake(intakeRows, { now });
  const unknownOutstanding = (unknownDocs || []).filter((d) => d && !d.posted).length;
  const outstanding = dropped.length + unknownOutstanding;

  // In-flight (uploaded, not yet at a resting place, but younger than the "stuck" window):
  // benign/transient — honest "still processing", NOT a red flag and NOT dropped.
  const nonTerminal = (intakeRows || []).filter((r) => r && !isTerminalIntake(r.status || INTAKE_STATUS.RECEIVED));
  const pendingCount = Math.max(0, nonTerminal.length - dropped.length);
  const totalDocs = (intakeRows || []).length;

  // ── The three-net gate — identical to the CPA sign-off (never diverges). ──
  const evalr = evaluateSignOff({ controlTotals, openConfidenceFlags, droppedDocs: dropped, unknownDocs });
  const accuracyOk = (controlTotals.failed || []).length === 0;
  const confidenceCount = (openConfidenceFlags || []).length;
  const confidenceOk = confidenceCount === 0;

  // ── CAPTURED (from completeness). Honest "still processing"; never a false all-clear. ──
  const capturedOk = outstanding === 0;
  let capturedText;
  if (outstanding > 0) {
    capturedText = `${outstanding} ${plural(outstanding, "document", "documents")} still ${plural(outstanding, "needs", "need")} attention — we couldn't file ${plural(outstanding, "it", "them")} automatically yet.`;
  } else if (pendingCount > 0) {
    capturedText = `Filing the ${pendingCount} ${plural(pendingCount, "document", "documents")} you just sent — almost done.`;
  } else if (totalDocs > 0) {
    capturedText = `Everything you sent is accounted for — ${totalDocs} ${plural(totalDocs, "document", "documents")}, nothing missing.`;
  } else {
    capturedText = "Nothing to file yet — send a receipt or bill and it'll be handled here.";
  }

  // ── REVIEWED (from O50 sign-off). Factual: what's signed off; honest when nothing is. ──
  const signedLabel = monthLabel(reviewedThrough);
  const reviewedText = signedLabel
    ? `Reviewed and signed off through ${signedLabel}.`
    : "Awaiting your accountant's sign-off.";

  // ── NOTHING WRONG (from confidence + accuracy). The ONE owner nudge is a confidence
  //    flag (owner can answer it); an accuracy mismatch is honest-but-not-owner-actionable. ──
  let nudge = null;
  let correctText;
  if (!confidenceOk) {
    correctText = `${confidenceCount === 1 ? "One transaction needs" : `${confidenceCount} transactions need`} a quick answer from you.`;
    nudge = { kind: "confidence", count: confidenceCount, text: `${confidenceCount === 1 ? "Answer 1 quick question" : `Answer ${confidenceCount} quick questions`}` };
  } else if (!accuracyOk) {
    // A control-total mismatch is a system/accountant concern, not an owner task — say so
    // plainly (no "control total" / "reconcile"), and DON'T fake green.
    correctText = "We're double-checking a couple of figures to make sure everything's right.";
  } else {
    correctText = "Nothing needs your attention — your books are correct and up to date.";
  }
  const correctOk = confidenceOk && accuracyOk;

  // ── Overall — mirrors the sign-off gate; in_progress only for benign in-flight docs. ──
  let overall, headline;
  if (!evalr.ok) {
    overall = "attention";
    headline = "A couple of things need a look.";
  } else if (pendingCount > 0) {
    overall = "in_progress";
    headline = "Your books are handled — just finishing up a couple of documents.";
  } else {
    overall = "all_clear";
    headline = "Your books are handled and up to date.";
  }

  return {
    overall,                       // "all_clear" | "in_progress" | "attention"
    headline,
    reviewedThrough: reviewedThrough || null,
    lines: {
      captured: { ok: capturedOk, pending: pendingCount > 0, text: capturedText },
      reviewed: { signed: !!signedLabel, text: reviewedText },
      correct: { ok: correctOk, text: correctText },
    },
    nudge,                         // at most one gentle "needs you" | null
    nets: { completeness: capturedOk, confidence: confidenceOk, accuracy: accuracyOk, signOffOk: evalr.ok },
  };
}
