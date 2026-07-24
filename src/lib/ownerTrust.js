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
  bankMatch = { overdue: false, days: null },   // from bankMatchStatus() — the SAME source as the dashboard alert
  // Open HIGH anomalies (O83) — persisted, company-wide. > 0 means the "Nothing wrong"
  // net can NEVER be green: something unusual is open and awaiting the accountant. This
  // is the fix for the O83 false "Nothing wrong" while 4 HIGH duplicate-payment anomalies
  // were live. Medium/low anomalies do NOT affect the owner panel (they carry no urgency
  // for the owner). Plain-language only — the owner never sees "duplicate_payment HIGH".
  openHighAnomalies = 0,
  // ── "Is there anything to evaluate yet?" signals (the false-green-on-empty fix). ──
  // A brand-new company with NO journal entries and NO completed setup has nothing to
  // evaluate — every net trivially "clears" (zero failures out of zero checks), which is
  // the SAME bug class as the O90 false-green: an empty gate reading as success. So before
  // any green/attention state, we branch to a NEUTRAL "let's get set up" state. These come
  // from the SAME data the home setup checklist counts (journal entries + onboardingSteps),
  // so the panel and the "0 of 4 done" checklist can never contradict each other.
  //   hasBooks       — at least one live journal entry exists (first entry booked).
  //   setupComplete  — onboarding's required steps are all done (obAllDone / onboardingComplete).
  // Default hasBooks=true so callers that don't pass the signal keep the prior behaviour
  // (evaluate, don't hide) — the app always passes the real signal.
  hasBooks = true,
  setupComplete = false,
  now = new Date(),
} = {}) {
  // ── NEUTRAL: nothing to evaluate yet. No green, no red, no "awaiting sign-off" — a
  //    plain "let's get set up" state. Exits the moment there's real data (first entry
  //    booked OR setup complete), which is when the status checks actually have substance. ──
  if (!hasBooks && !setupComplete) {
    return {
      overall: "neutral",
      neutral: true,
      headline: "Let's get you set up first",
      subtext: "Your books status will appear here once your business info and first transactions are in.",
      reviewedThrough: null,
      lines: null,                 // no per-net breakdown — there's nothing to break down
      nudge: null,
      nets: { completeness: false, confidence: false, accuracy: false, bankMatched: false, signOffOk: false },
    };
  }

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

  // ── DOCUMENTS (document-UPLOAD completeness — O60 intake ledger, NOT the whole books). Did
  //    any file the owner uploaded fall through before becoming an entry? Honest "still
  //    processing"; never a false all-clear; neutral (not a gap) when nothing was uploaded. ──
  const capturedOk = outstanding === 0;
  let capturedText, capturedStateVal;
  if (outstanding > 0) {
    capturedText = `${outstanding} ${plural(outstanding, "document", "documents")} still ${plural(outstanding, "needs", "need")} attention — we couldn't file ${plural(outstanding, "it", "them")} automatically yet.`;
    capturedStateVal = "attention";
  } else if (pendingCount > 0) {
    capturedText = `Filing the ${pendingCount} ${plural(pendingCount, "document", "documents")} you just sent — almost done.`;
    capturedStateVal = "info";
  } else if (totalDocs > 0) {
    capturedText = `Everything you sent is accounted for — ${totalDocs} ${plural(totalDocs, "document", "documents")}, nothing missing.`;
    capturedStateVal = "ok";
  } else {
    // NEUTRAL, not a gap: this line is document-UPLOAD completeness, not "all your activity".
    // A bank-fed or seeded company has a full ledger but no uploaded docs — never imply
    // something's missing. (See the O94 "all-activity-captured" signal for the broader idea.)
    capturedText = "No documents waiting — drop a receipt or bill here anytime.";
    capturedStateVal = "info";
  }

  // ── REVIEWED (from O50 sign-off). Factual: what's signed off; honest when nothing is. ──
  const signedLabel = monthLabel(reviewedThrough);
  const reviewedText = signedLabel
    ? `Reviewed and signed off through ${signedLabel}.`
    : "Awaiting your accountant's sign-off.";

  // ── NOTHING WRONG (from confidence + accuracy + bank-match). The ONE owner nudge is a
  //    confidence flag (owner can answer it). An accuracy mismatch is honest-but-not-owner-
  //    actionable. "Bank not yet matched" is a real, honest in-progress state — NOT green, NOT
  //    alarming, and NO competing nudge (the dashboard's own bank-match reminder carries the
  //    "upload a statement" action, from the SAME bankMatchStatus source). ──
  const bankOverdue = !!(bankMatch && bankMatch.overdue);
  const anomalyCount = Math.max(0, Number(openHighAnomalies) || 0);
  const anomaliesOk = anomalyCount === 0;
  let nudge = null;
  let correctText, correctStateVal;
  if (!confidenceOk) {
    correctText = `${confidenceCount === 1 ? "One transaction needs" : `${confidenceCount} transactions need`} a quick answer from you.`;
    correctStateVal = "attention";
    nudge = { kind: "confidence", count: confidenceCount, text: `${confidenceCount === 1 ? "Answer 1 quick question" : `Answer ${confidenceCount} quick questions`}` };
  } else if (!anomaliesOk) {
    // Something unusual is open (e.g. a possible duplicate payment). Not an owner task —
    // the accountant reviews it — so honest, reassuring, and NOT green. No jargon.
    correctText = `${anomalyCount === 1 ? "Something looks" : `${anomalyCount} things look`} unusual — your accountant is taking a look.`;
    correctStateVal = "attention";
  } else if (!accuracyOk) {
    // A control-total mismatch is a system/accountant concern, not an owner task — say so
    // plainly (no "control total" / "reconcile"), and DON'T fake green.
    correctText = "We're double-checking a couple of figures to make sure everything's right.";
    correctStateVal = "attention";
  } else if (bankOverdue) {
    // The false-green this fix closes: books can be internally consistent yet UNVERIFIED against
    // the bank. Say it plainly (no "reconcile" jargon) and don't claim "up to date".
    correctText = "We're still matching your books to your bank.";
    correctStateVal = "info";
  } else {
    correctText = "Nothing needs your attention — your books are correct and up to date.";
    correctStateVal = "ok";
  }
  const correctOk = confidenceOk && accuracyOk && !bankOverdue && anomaliesOk;

  // ── Overall — never all_clear unless the three sign-off nets clear AND the books are matched
  //    to the bank AND no open HIGH anomaly AND nothing's mid-flight. Anomalies are NOT part
  //    of evaluateSignOff (that's the three doc/confidence/accuracy nets), so gate on them
  //    explicitly here — otherwise an open duplicate-payment would read as all_clear (the O83
  //    bug). Bank-not-matched / in-flight docs → in_progress; a short net or open anomaly →
  //    attention. ──
  let overall, headline;
  if (!evalr.ok || !anomaliesOk) {
    overall = "attention";
    headline = "A couple of things need a look.";
  } else if (bankOverdue || pendingCount > 0) {
    overall = "in_progress";
    headline = "Your books are handled — a couple of things are still finishing up.";
  } else {
    overall = "all_clear";
    headline = "Your books are handled and up to date.";
  }

  return {
    overall,                       // "all_clear" | "in_progress" | "attention"
    headline,
    reviewedThrough: reviewedThrough || null,
    lines: {
      captured: { ok: capturedOk, pending: pendingCount > 0, state: capturedStateVal, text: capturedText },
      reviewed: { signed: !!signedLabel, state: signedLabel ? "ok" : "info", text: reviewedText },
      correct: { ok: correctOk, state: correctStateVal, text: correctText },
    },
    nudge,                         // at most one gentle "needs you" | null
    nets: { completeness: capturedOk, confidence: confidenceOk, accuracy: accuracyOk, bankMatched: !bankOverdue, noAnomalies: anomaliesOk, signOffOk: evalr.ok },
  };
}
