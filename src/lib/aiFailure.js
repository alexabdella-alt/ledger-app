// ─────────────────────────────────────────────────────────────────────────────
// WHEN THE AI CALL FAILS — SAY WHICH FAILURE IT WAS.
//
// Every failure became one string: `AI service error (429 Too Many Requests): …`. That is
// jargon on an owner surface, and worse, it **collapses four situations that need four
// different responses**:
//   · OUR OWN rate limit — self-resolving, and the 429 already carries WHICH budget and
//     WHEN it resets (`O113a`). All of that was being thrown away into a string.
//   · The provider being overloaded — theirs, wait, retry helps.
//   · The account being out of credit — **nobody's retry will ever help**; it needs the
//     operator. This is the O84 finding: the org ran out mid-drive and extraction-dependent
//     features failed with no in-app explanation.
//   · A configuration/auth failure — retrying is pointless and it is our bug.
//
// ★ THE DISTINCTION THAT MATTERS MOST IS "WILL WAITING FIX THIS?" — because it is the only
// one that tells the person what to DO, and it is also what the intake drain needs in order
// to decide between retrying and handing the document to a human with a reason.
//
// ★★ AND THE COPY IS A CLAIM ABOUT THE CALL, NEVER ABOUT THE BOOKS (§9/O98). "We couldn't
// read this document just now" is true; "this document has a problem" is not, and the
// difference is the whole reason a person does or does not go looking for a problem.
//
// Pure. No fetch, no client.
// ─────────────────────────────────────────────────────────────────────────────

export const AI_FAILURE = {
  OUR_LIMIT: "our_limit",             // our per-user hourly budget (migration 021 / O113)
  PROVIDER_BUSY: "provider_busy",     // upstream overloaded / 5xx
  OUT_OF_CREDIT: "out_of_credit",     // the account has no balance — a human must act
  NOT_CONFIGURED: "not_configured",   // auth/config — our bug, retrying is pointless
  UNKNOWN: "unknown",
};

const text = (v) => String(v == null ? "" : v).toLowerCase();

// `body` is the proxy's JSON when it parsed, so the structured 429 fields survive.
export function classifyAIFailure({ status = null, body = null, message = "" } = {}) {
  const s = Number(status);
  const b = body || {};
  const msg = text(message || b.error?.message || b.error || b.message || "");

  // ── OUT OF CREDIT, FIRST. It can arrive as a 400 or a 429 depending on the provider, and
  // mistaking it for a rate limit is the costly error: one resolves itself in an hour and
  // the other never resolves until somebody pays. Matched on the words because the status
  // code alone cannot tell them apart.
  if (/credit balance|insufficient (credit|funds|quota)|billing|payment required|exceeded your current quota/.test(msg) || s === 402) {
    return {
      kind: AI_FAILURE.OUT_OF_CREDIT, retryable: false, waitingHelps: false, resetsInMinutes: null,
      owner: "We can't read documents right now — this is on us, not your file. Nothing has been lost; it'll process once we're back.",
      operator: "The AI account is out of credit. Top it up — document reading is paused until then, and retrying will not clear it.",
    };
  }

  // ── OUR OWN LIMIT. The proxy sends `blocked_bucket` and `resets_in_minutes` (O113a), so
  // the sentence can name a real number instead of an adjective.
  if (s === 429) {
    const mins = Number(b.resets_in_minutes);
    const when = Number.isFinite(mins) && mins > 0
      ? (mins < 60 ? `about ${Math.round(mins)} minute${Math.round(mins) === 1 ? "" : "s"}` : "about an hour")
      : null;
    return {
      kind: AI_FAILURE.OUR_LIMIT, retryable: true, waitingHelps: true,
      resetsInMinutes: Number.isFinite(mins) ? mins : null,
      bucket: b.blocked_bucket || null,
      // ★ Says it is a LIMIT OF OURS, not a problem with their file, and never asks them to
      // retry — the drain does that. Before `O113a` retrying actively made it worse, and
      // nothing on screen said so.
      owner: `We've hit our own hourly limit for reading documents${when ? `, which clears in ${when}` : ""}. Everything you sent is saved and will carry on automatically — there's nothing to re-send.`,
      operator: `Rate limit: ${b.blocked_bucket || "ai"} bucket exhausted${when ? `, resets in ${when}` : ""}.`,
    };
  }

  if (s === 401 || s === 403) {
    return {
      kind: AI_FAILURE.NOT_CONFIGURED, retryable: false, waitingHelps: false, resetsInMinutes: null,
      owner: "We can't read documents right now — this is a problem on our side, not with your file.",
      operator: "The AI proxy rejected our credentials (401/403). Check the edge function's project secrets — retrying will not help.",
    };
  }

  if (s === 500 || s === 502 || s === 503 || s === 504 || /overloaded|timeout|timed out|temporarily unavailable|fetch failed|network/.test(msg)) {
    return {
      kind: AI_FAILURE.PROVIDER_BUSY, retryable: true, waitingHelps: true, resetsInMinutes: null,
      owner: "The document reader is busy right now. Everything you sent is saved and we'll keep trying — there's nothing to re-send.",
      operator: `Upstream unavailable${s ? ` (${s})` : ""} — transient; the drain will retry.`,
    };
  }

  return {
    kind: AI_FAILURE.UNKNOWN, retryable: false, waitingHelps: false, resetsInMinutes: null,
    // ★ AN UNRECOGNISED FAILURE IS REPORTED AS UNRECOGNISED. Guessing "we'll keep trying"
    // on something we cannot classify is how a document sits in a retry loop forever
    // (`intakeDrain`'s doctrine: unrecognised is PERMANENT, the visible direction).
    owner: "We couldn't read this one, and we're not sure why. Your accountant will take a look — nothing has been lost.",
    operator: `Unclassified AI failure${s ? ` (${s})` : ""}: ${message || "(no message)"}`,
  };
}

// Is the whole document-reading feature down, as opposed to one file failing? Two kinds
// qualify, and both are ours: no credit, and no working credentials. Used for the banner —
// a per-file error should never claim the feature is down.
export function isDegradedMode(kind) {
  return kind === AI_FAILURE.OUT_OF_CREDIT || kind === AI_FAILURE.NOT_CONFIGURED;
}

export function degradedBannerCopy(kind) {
  if (!isDegradedMode(kind)) return null;
  return kind === AI_FAILURE.OUT_OF_CREDIT
    ? "Document reading is paused — we're sorting it out on our end. You can still upload; everything is saved and will process as soon as it's back."
    : "Document reading is paused while we fix something on our end. You can still upload; everything is saved and will process once it's back.";
}
