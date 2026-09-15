// ─────────────────────────────────────────────────────────────────────────────
// C409 — "WE COULDN'T ASK" IS NOT "THERE ARE NONE", ON EVERY RECORDS SCREEN.
//
// `loadAllData` reads twelve secondary tables with `allSettled` (C277), and a read that
// failed — rejected, or fulfilled with PostgREST's `{ data: null, error }` — becomes `{}`
// so its consumer takes the "no data" branch. C277 preserved that deliberately. The
// consequence one layer up is that a failed `contacts` read renders the Vendors screen
// as "No vendors yet", a failed `documents` read as "No documents yet", a failed
// `audit_log` read as "No activity recorded yet": O98 — an empty result is a claim about
// the QUERY, and these screens made it a claim about the company. C250 closed this on
// the Team screen alone; this is the class.
//
// `settledFailures` turns the settled array into `{ table: message }` — a fulfilled
// response carrying `error` counts, because PostgREST reports a bad select that way
// rather than by rejecting (C308's column-name failure would have been one). The
// screens ask `loadFailures[table]` before rendering an empty state.
//
// Pure.
// ─────────────────────────────────────────────────────────────────────────────

export function settledFailures(settled = [], names = []) {
  const out = {};
  settled.forEach((r, i) => {
    const name = names[i];
    if (!name) return;
    if (r.status === "rejected") { out[name] = String(r.reason?.message || r.reason || "request failed"); return; }
    const err = r.value && r.value.error;
    if (err) out[name] = String(err.message || err);
  });
  return out;
}

// The sentence an owner reads in place of "No X yet" when the read did not run.
// It says two things on purpose: that we could not check, and that this is not a
// confirmation of absence — a silently empty list is the most reassuring way to be wrong.
export function loadFailedCopy(what) {
  return `We couldn't load your ${what} just now, so this list may be incomplete — it isn't a confirmation that there are none. Reload the page to try again.`;
}
