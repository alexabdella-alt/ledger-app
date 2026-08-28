// ─────────────────────────────────────────────────────────────────────────────
// O97 STEP 2 — THE DRAIN (planning half).
//
// Decides which stored-but-unprocessed documents to pick up, which to leave alone, and
// which to stop retrying. Pure: no client, no fetch, no booking primitive, no clock —
// `now` is passed in, so every decision is reproducible and testable.
//
// ★★ NO MIGRATION. The retry state this needs is already on the table (verified live
// 2026-08-28): `document_id` says the bytes are durable, `status` is the state machine,
// `updated_at` is both the lease and the spacing gate, `received_at` is the age. And
// `document_intake_company_status_idx` is already exactly the selection path.
//   · `attempts` was considered and DEFERRED — it buys a nicer report ("we tried 9 times"
//     vs "we retried for 36 hours"), not a correct decision. Both statements are true;
//     only one needs a column, and it is additive with a default whenever we want it.
//   · `next_attempt_at` was rejected outright: the thing we wait for is an AI budget that
//     resets on a CLOCK HOUR, so a fixed interval derived from that is the schedule. A
//     per-row time column would store the same number redundantly.
//
// ★ TRANSIENT-vs-PERMANENT COMES FROM THE ERROR, NOT FROM A COUNT. A 429 is transient
// however many times it happens; an unreadable file is permanent on the first try. A
// counter would only bound repeated TRANSIENT failure, which the age box already does.
// ─────────────────────────────────────────────────────────────────────────────

export const FAILURE_KIND = { TRANSIENT: "transient", PERMANENT: "permanent" };

export const DRAIN_ACTION = {
  PICK: "pick",   // process it now
  WAIT: "wait",   // leave it — in flight, or too soon to retry
  HOLD: "hold",   // stop retrying; hand to a human with a stated reason
  SKIP: "skip",   // not drainable at all (no bytes, or already finished)
};

export const DRAIN_SKIP = {
  NO_DURABLE_BYTES: "no_durable_bytes",   // predates O97 step 1 — unrecoverable, see below
  TERMINAL: "terminal",
};

export const DRAIN_WAIT = { IN_FLIGHT: "in_flight", TOO_SOON: "too_soon" };

// Defaults chosen against the failure we actually have, not against a generic queue:
//  · leaseMinutes — a row left `processing` this long has lost its worker (a closed tab).
//  · spacingMinutes — the floor between retries. Deliberately NOT seconds: the dominant
//    transient failure is an hourly rate limit, and hammering inside a blocked hour
//    accomplishes nothing. (Before `O113a` it was actively harmful — every refused call
//    was still charged.)
//  · giveUpHours — generous ON PURPOSE. 240 documents at 20/hour is twelve hours of
//    legitimate waiting, so a box tight enough to feel decisive would abandon a perfectly
//    healthy onboarding. Erring long costs a slow queue; erring short costs a lost file.
export const DRAIN_DEFAULTS = { leaseMinutes: 10, spacingMinutes: 5, giveUpHours: 36 };

const TERMINAL = new Set(["recorded", "held_for_review", "rejected"]);

const minutesBetween = (a, b) => (new Date(b) - new Date(a)) / 60000;

// ── CLASSIFYING A FAILURE ────────────────────────────────────────────────────
// Read the error, not a counter. Anything we cannot recognise is PERMANENT — the
// conservative direction, because retrying an unknown failure forever is how a queue
// becomes a loop, and a document held with a stated reason is visible while a document
// retried forever is not.
export function classifyFailure(err) {
  const status = Number(err && (err.status ?? err.statusCode));
  const msg = String((err && (err.message ?? err)) || "").toLowerCase();
  if (status === 429 || status === 503 || status === 502 || status === 504) return FAILURE_KIND.TRANSIENT;
  if (/rate limit|too many requests|timeout|timed out|network|temporarily unavailable|fetch failed/.test(msg)) {
    return FAILURE_KIND.TRANSIENT;
  }
  return FAILURE_KIND.PERMANENT;
}

// ── ONE ROW ──────────────────────────────────────────────────────────────────
export function planRow(row = {}, { now, opts = {} } = {}) {
  const o = { ...DRAIN_DEFAULTS, ...opts };
  const status = String(row.status || "");

  // ★ THE GATE STEP 1 EXISTS TO OPEN. No durable bytes means the file only ever lived in
  // an in-memory ref, so there is nothing to resume — the work is gone, not pending.
  // COUNTED, never silently dropped: on 2026-08-28 this was 150 of 150 rows, and a drain
  // that reported "nothing to do" over that population would be describing an empty input
  // as a clean queue (C195(7)).
  if (!row.document_id) return { action: DRAIN_ACTION.SKIP, reason: DRAIN_SKIP.NO_DURABLE_BYTES };
  if (TERMINAL.has(status)) return { action: DRAIN_ACTION.SKIP, reason: DRAIN_SKIP.TERMINAL };

  const sinceUpdate = row.updated_at == null ? Infinity : minutesBetween(row.updated_at, now);
  const age = row.received_at == null ? 0 : minutesBetween(row.received_at, now) / 60;

  // In flight: someone is working it, and the lease has not expired.
  if (status === "processing" && sinceUpdate < o.leaseMinutes) {
    return { action: DRAIN_ACTION.WAIT, reason: DRAIN_WAIT.IN_FLIGHT };
  }

  // ★ GIVE UP BEFORE PICKING, or an old row is retried once more on the way out and the
  // hold reason is written against an attempt that already failed.
  if (age >= o.giveUpHours) {
    return { action: DRAIN_ACTION.HOLD,
             reason: `gave_up_after_${o.giveUpHours}h`,
             detail: `Still not processed ${Math.floor(age)} hours after it arrived — handed to your accountant rather than retried again.` };
  }

  // Too soon since the last attempt. A stale `processing` row skips this: its lease has
  // expired, which means the last attempt did not finish, so spacing has already elapsed.
  if (status !== "processing" && sinceUpdate < o.spacingMinutes) {
    return { action: DRAIN_ACTION.WAIT, reason: DRAIN_WAIT.TOO_SOON };
  }

  return { action: DRAIN_ACTION.PICK, reason: status === "processing" ? "lease_expired" : status };
}

// ── THE PASS ─────────────────────────────────────────────────────────────────
// `limit` caps how many are handed out at once — the caller's budget, not a policy here.
// Returns the picks AND a full census, because "how many did we skip and why" is the only
// way to tell a drained queue from a drain that never had anything to do.
export function planDrain({ rows = [], now = null, limit = 10, opts = {} } = {}) {
  if (!now) throw new Error("[intakeDrain] `now` must be supplied — the planner owns no clock");

  const decided = (rows || []).map((r) => ({ row: r, ...planRow(r, { now, opts }) }));
  const oldestFirst = (a, b) => String(a.row.received_at || "").localeCompare(String(b.row.received_at || ""));

  // Oldest first: a queue that serves newest-first starves the documents a user has
  // already been waiting on, which is the complaint this whole item exists to answer.
  const pick = decided.filter((d) => d.action === DRAIN_ACTION.PICK).sort(oldestFirst).slice(0, limit);
  const deferred = decided.filter((d) => d.action === DRAIN_ACTION.PICK).length - pick.length;

  const counts = { pick: pick.length, deferred, wait: 0, hold: 0, skip: 0 };
  const reasons = {};
  for (const d of decided) {
    if (d.action !== DRAIN_ACTION.PICK) counts[d.action] += 1;
    const key = `${d.action}:${d.reason}`;
    reasons[key] = (reasons[key] || 0) + 1;
  }

  return {
    pick,
    hold: decided.filter((d) => d.action === DRAIN_ACTION.HOLD),
    counts,
    reasons,
    // ★ The honest denominator. `drainable` counts rows this drain could EVER act on;
    // when it is 0 the correct report is "nothing is resumable", NOT "all caught up".
    drainable: decided.filter((d) => d.reason !== DRAIN_SKIP.NO_DURABLE_BYTES && d.reason !== DRAIN_SKIP.TERMINAL).length,
    unresumable: decided.filter((d) => d.reason === DRAIN_SKIP.NO_DURABLE_BYTES).length,
  };
}

// ── WHAT THE OWNER IS TOLD ───────────────────────────────────────────────────
// Derived from the plan, never composed alongside it (CLAUDE.md §9 — describe from the
// record). Every clause reads a field of the census above.
//
// ★ THE FINISH TIME IS ARITHMETIC, NOT AN ESTIMATE: documents remaining ÷ our own hourly
// rate. When the rate is unknown — because the AI budget is shared and something else may
// be consuming it (`O113b`) — we state the counts and OMIT the time. An unknown time is
// stated as unknown, never as a spinner.
export function drainProgressCopy({ stored = 0, done = 0, plan = null, perHour = null } = {}) {
  if (!stored) return "Nothing waiting.";
  const remaining = Math.max(0, stored - done);
  if (remaining === 0) return `All ${stored} of your documents are sorted.`;

  const head = `All ${stored} of your documents are safely stored. We've sorted ${done} so far and we're working through the rest`;
  const tail = " You can close this and come back; your place is saved.";

  if (plan && plan.drainable === 0 && plan.unresumable > 0) {
    // The honest report for the pre-step-1 population: not "caught up".
    return `${plan.unresumable} document${plan.unresumable === 1 ? "" : "s"} from before we started keeping copies can't be picked back up — they'd need uploading again.`;
  }
  if (!perHour || perHour <= 0) return `${head}.${tail}`;   // rate unknown → no time, and no spinner

  const hours = remaining / perHour;
  const when = hours < 1 ? "within the hour" : `in about ${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"}`;
  return `${head} — they'll be done ${when}.${tail}`;
}
