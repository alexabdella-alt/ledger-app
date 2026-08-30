// ─────────────────────────────────────────────────────────────────────────────
// THE PROCESSING QUEUE'S TILE — WHEN THE WORDS AND THE COLOUR DISAGREE, THE COLOUR WINS.
//
// `O97`'s defect, stated by the operator: *200 files in, 20 succeed, 180 turn red, and the
// owner concludes the product is broken.* The pipeline half of that is already fixed —
// a rate-limited file is stored durably, marked FAILED so the drain retries it, and carries
// the honest sentence `aiFailure.owner`:
//
//     "We've hit our own hourly limit for reading documents, which clears in about 40
//      minutes. Everything you sent is saved and will carry on automatically — there's
//      nothing to re-send."
//
// ★★ AND THE TILE RENDERED THAT SENTENCE IN RED, UNDER A ⚠, INSIDE A RED BORDER, BESIDE A
// CHIP READING "Error". Five signals saying BROKEN wrapped around one sentence saying FINE.
// **Nobody reads the sentence — they read the colour**, which is why correct copy did not
// save the drive. A queue item already carried `transient` (set in the upload catch from
// `classifyAIFailure().retryable`) and **not one line of the view read it.**
//
// ★ THIS IS THE §9 DESCRIBE-FROM-THE-RECORD RULE AT THE PRESENTATION LAYER. The other
// instances had a SENTENCE diverge from the outcome; here the sentence is right and the
// STYLING is the parallel description that diverged. So the tone is derived from the
// recorded item — one function, one place — rather than each of five style expressions
// re-deciding what the status means. Five independent readings is how they disagreed.
//
// Pure. No React, no styles — it returns a TONE, and the view owns what a tone looks like.
// ─────────────────────────────────────────────────────────────────────────────

export const QUEUE_TONE = {
  NEUTRAL:  "neutral",    // queued, nothing has happened yet
  PROGRESS: "progress",   // running right now, in this tab
  SUCCESS:  "success",    // done, nothing outstanding
  REVIEW:   "review",     // done, but it asked a question
  WAITING:  "waiting",    // ★ not finished, NOT broken — it resumes on its own
  ERROR:    "error",      // finished badly; a person has to do something
};

// ★ THE ONE DISTINCTION THAT MATTERS: "is a person needed?" A transient failure is the
// system's own budget, and the drain retries it with no human involved — so it must not
// wear the costume of a thing that needs attention. Reserving red for what a person can
// actually act on is what keeps red meaning anything at all.
export function queueItemTone(item = {}, { pendingReview = false } = {}) {
  const status = String(item.status == null ? "" : item.status);
  if (status === "error") return item.transient ? QUEUE_TONE.WAITING : QUEUE_TONE.ERROR;
  if (status === "done") return pendingReview ? QUEUE_TONE.REVIEW : QUEUE_TONE.SUCCESS;
  if (status === "classifying" || status === "processing") return QUEUE_TONE.PROGRESS;
  return QUEUE_TONE.NEUTRAL;
}

// The chip. `null` means no chip — a running or queued item is described by its own line,
// and a chip saying "Processing" beside "⟳ Processing as Invoice…" is noise.
//
// ★ THE WAITING CHIP DOES NOT SAY "Retrying". We are not retrying it now; it is in a queue
// whose turn comes when our budget resets. "Retrying" invites the person to watch for a
// change that will not arrive for the better part of an hour.
export function queueItemChip(tone, item = {}) {
  switch (tone) {
    case QUEUE_TONE.SUCCESS: return "Done";
    case QUEUE_TONE.REVIEW:  return "⚠ Needs Review";
    case QUEUE_TONE.WAITING: return "Waiting its turn";
    case QUEUE_TONE.ERROR:
      // The pipeline's own outcome is more specific than the generic word, so prefer it.
      return item.result?.failed && item.result?.to === "pipeline" ? "Needs a look" : "Error";
    default: return null;
  }
}

// ★ AN HOURGLASS, NOT A WARNING TRIANGLE. The glyph is the first thing read and the last
// thing doubted; ⚠ on a file that is fine is the whole bug in one character.
export function queueItemIcon(tone, typeIcon = "📄") {
  switch (tone) {
    case QUEUE_TONE.SUCCESS:
    case QUEUE_TONE.REVIEW:  return typeIcon;
    case QUEUE_TONE.WAITING: return "⏳";
    case QUEUE_TONE.ERROR:   return "⚠";
    default: return "📄";
  }
}

// Is every item finished as far as THIS TAB is concerned? Drives the "Clear ×" affordance.
//
// ★ WAITING COUNTS AS SETTLED HERE, DELIBERATELY, AND IT IS A CLOSE CALL. Clearing hides a
// list; it does not cancel anything — the drain works from `document_intake`, not from this
// React state, so cleared work still runs. And the drain's own banner reports the census
// independently of this queue, so the count survives the clear. Blocking Clear would strand
// someone behind 180 rows they cannot dismiss, to protect information that is still on
// screen anyway.
export function queueIsSettled(items = []) {
  const list = items || [];
  if (!list.length) return false;
  return list.every((q) => q && (q.status === "done" || q.status === "error"));
}

// What the queue actually amounts to, for a summary line. Counted from the tones so it can
// never disagree with the tiles it is summarising.
export function queueCensus(items = [], { pendingReviewIds = [] } = {}) {
  const review = new Set((pendingReviewIds || []).map(String));
  const out = { done: 0, waiting: 0, error: 0, review: 0, running: 0, queued: 0 };
  for (const item of items || []) {
    if (!item) continue;
    const tone = queueItemTone(item, { pendingReview: review.has(String(item.id)) });
    if (tone === QUEUE_TONE.SUCCESS) out.done++;
    else if (tone === QUEUE_TONE.REVIEW) out.review++;
    else if (tone === QUEUE_TONE.WAITING) out.waiting++;
    else if (tone === QUEUE_TONE.ERROR) out.error++;
    else if (tone === QUEUE_TONE.PROGRESS) out.running++;
    else out.queued++;
  }
  return out;
}
