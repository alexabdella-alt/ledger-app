// ─────────────────────────────────────────────────────────────────────────────
// O83 — pure reconcile between freshly-detected anomalies (runAnomalyDetection,
// insights.js) and the PERSISTED `anomalies` table rows (migration 056).
//
// Detection is a pure function of the current ledger, so "auto-resolve" is just a
// set-difference: an open fingerprint that is no longer detected means its condition
// disappeared (e.g. the duplicate was deleted) → resolve it, keeping the row as
// history. Clearing is now an EVENT, not amnesia. This module is pure + tested; the
// App wires the batched DB writes around it (one read + batched insert/resolve).
// ─────────────────────────────────────────────────────────────────────────────

export const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };
export const isHighAnomaly = (a) => !!a && a.severity === "high";

// The three ways an anomaly can close (migration 056 + 060). They must not blur:
//   auto      — the condition disappeared; the next scan noticed, honestly.
//   dismissed — a human judged THIS note acceptable, reason required.
//   attested  — a human attested the MONTH over it. Nobody judged the note itself,
//               so it must never feed priorDismissalFor (which reads dismissals as
//               vendor+amount judgements and quiets later duplicates on the strength
//               of them). C198·3b (f1).
export const ANOMALY_RESOLUTION = { AUTO: "auto", DISMISSED: "dismissed", ATTESTED: "attested" };
export const ATTESTED_NOTE = "period attested over this note";

// The linked journal-entry ids for an anomaly, from either shape (persisted row's
// `entity_refs` or a freshly-detected anomaly's `invoice_ids`).
function refIds(anomaly) {
  if (!anomaly) return [];
  if (Array.isArray(anomaly.entity_refs)) return anomaly.entity_refs;
  if (Array.isArray(anomaly.invoice_ids)) return anomaly.invoice_ids;
  return [];
}

// ── C198·3c — THE MONTHS A FINGERPRINT ITSELF ENCODES ────────────────────────
// ONE parser, two consumers. The f3 content keys carry their subject's own dates —
// `dup:<vendor>:<cents>:<dateA>+<dateB>`, `vendor_spike:<vendor>:<date>:<cents>`,
// `large_txn:…`, `round:…`, `rapid:<vendor>:<date>:<count>` — while the aggregate
// anomalies (category_spike) carry a `…:YYYY-MM` tail instead. Both period functions
// read this, deliberately: the (v) bug was ·3b re-keying fingerprints and ·3b consuming
// them in the same commit while the two halves disagreed about the format. Two
// independent parsers of the same key is that same trap with the sides swapped.
function fingerprintMonths(fp) {
  const s = String(fp || "");
  const tail = /:(\d{4}-\d{2})$/.exec(s);
  if (tail) return [tail[1]];
  const dates = s.match(/\d{4}-\d{2}-\d{2}/g);
  return dates ? dates.map((d) => d.slice(0, 7)) : [];
}

// Do this anomaly's refs resolve to anything at all, and if so which months?
// `resolved: false` is the (v) condition: the row HAS refs, and none of them are in
// the ledger any more — which is not the same as having no refs, and is exactly the
// case both callers used to mistake for "unplaceable".
function refMonths(anomaly, invoices) {
  const refs = refIds(anomaly);
  if (!refs.length) return { resolved: false, months: [] };
  const byId = new Map((invoices || []).map((i) => [String(i.id), i]));
  const months = [];
  for (const r of refs) {
    const inv = byId.get(String(r));
    const p = inv && String(inv.date || "").slice(0, 7);
    if (p && p.length === 7) months.push(p);
  }
  return { resolved: months.length > 0, months };
}

// Does this anomaly touch the given sign-off period (YYYY-MM)? Entry-linked anomalies
// resolve their refs → dates via the invoices array. Aggregate anomalies (e.g.
// category_spike, which carries no entry refs) encode the month in the fingerprint
// tail (`…:YYYY-MM`) — fall back to that so a month-scoped spike still period-gates.
//
// C198·3c (D1) — THE FINGERPRINT FALLBACK APPLIES HERE TOO, and for a sharper reason
// than it did for anomalySubjectPeriod. The only consumer of this function is
// openHighAnomaliesInPeriod → signOffReadiness: the gate that BLOCKS a sign-off on an
// open HIGH note. `duplicate_payment` is emitted at severity high with an f3 date-pair
// key, so under the exact (v) condition — persisted rows whose entity_refs stopped
// resolving after a reload — this returned false and the blocker silently UNDER-counted.
// A sign-off gate that fails to block is the dangerous direction; the sweep failing to
// retire (the (v) symptom) merely leaves a note open.
//
// Which is why `rapid:` is EXCLUDED from anomalySubjectPeriod's fallback but INCLUDED
// here, and the asymmetry is the point. Its key holds the window START while its refs
// span up to 48 hours, so the month it names is under-inclusive. For a function that
// RETIRES notes, an under-inclusive month is a note retired a month early — unsafe. For
// a function that BLOCKS sign-off, an under-inclusive month is one fewer month blocked,
// and TOUCHES asks "does any part of this land in the period", to which the window's
// first charge is a truthful yes. Over-blocking is the safe side of this one.
export function anomalyTouchesPeriod(anomaly, period, invoices = []) {
  if (!anomaly || !period) return false;
  const refs = refMonths(anomaly, invoices);
  if (refs.resolved) return refs.months.some((m) => m === period);
  return fingerprintMonths(anomaly.fingerprint || anomaly.id).some((m) => m === period);
}

// The single period an anomaly is ABOUT (YYYY-MM), or null when it can't be placed.
// An anomaly spanning a month boundary (a duplicate pair straddling Jan 30 / Feb 2)
// reports its LATEST month — so attesting the earlier month never retires a note that
// also reaches into a month nobody has attested yet.
//
// Three ways to place it, in descending order of authority:
//   1. REFS  — resolve entity_refs/invoice_ids to their entries and take the latest date.
//   2. MONTH TAIL — the aggregate anomalies (category_spike) that carry no refs encode
//      their month in the fingerprint tail (`…:YYYY-MM`).
//   3. FULL DATES IN THE FINGERPRINT (C198·3c (v)) — the f3 content keys embed the
//      subject's own dates (`dup:<vendor>:<cents>:<dateA>+<dateB>`,
//      `vendor_spike:<vendor>:<date>:<cents>`, `rapid:<vendor>:<date>:<count>`), so the
//      month can be read straight off the key. Take the LATEST date, for the same
//      straddle reason as (1).
//
// WHY (3) EXISTS, and why it is NOT gated on `refs.length === 0`. At July's sign-off the
// f1 sweep skipped three duplicate cards. Both prior paths missed them for INDEPENDENT
// reasons: ·3b(f3) re-keyed duplicate fingerprints to a date-PAIR tail that the
// `:YYYY-MM$` regex can't match, AND the detection-time `invoice_ids` on those persisted
// rows no longer resolved against a reloaded ledger. So `refs.length` was non-zero — the
// old code never even reached its fallback — and every ref resolved to nothing. Placing
// the fallback behind "no refs" would have left the live trio exactly as stuck; the
// condition that matters is "the refs didn't RESOLVE", not "there are no refs". (Note
// the shape of the original miss: ·3b re-keyed the fingerprints and ·3b consumed them,
// in the SAME commit, and the two halves disagreed about the format.)
//
// The conservative skip stays: nothing parses → null → anomaliesExpiredBySignoff leaves
// the note open. Failing to place a note must never mean retiring it.
export function anomalySubjectPeriod(anomaly, invoices = []) {
  if (!anomaly) return null;
  const refs = refMonths(anomaly, invoices);
  if (refs.resolved) return refs.months.reduce((mx, m) => (m > mx ? m : mx));   // refs are the authority
  const fp = String(anomaly.fingerprint || anomaly.id || "");
  // `rapid:<vendor>:<date>:<count>` is the one f3 key whose date is the WINDOW START,
  // not the subject: its refs are every charge in a 48-hour window, which can reach into
  // the next month. Reading the month off that key would place a straddling note EARLY
  // and let the earlier month's sign-off retire it — the exact guarantee this function's
  // "latest month" rule exists to keep. Unplaceable is the correct answer; it stays open.
  // (anomalyTouchesPeriod deliberately does NOT make this exclusion — see the note there.)
  if (/^rapid:/.test(fp)) return null;
  const months = fingerprintMonths(fp);
  return months.length ? months.reduce((mx, m) => (m > mx ? m : mx)) : null;
}

// Count of OPEN HIGH anomalies whose refs touch `period` — the sign-off blocker input.
// (Medium/low NEVER block a sign-off; they surface in the CPA queue but don't gate.)
export function openHighAnomaliesInPeriod(rows = [], period, invoices = []) {
  return (rows || []).filter(
    (a) => a && a.status === "open" && isHighAnomaly(a) && anomalyTouchesPeriod(a, period, invoices)
  ).length;
}

// THE RECONCILE (pure). Given freshly detected anomalies + the current persisted rows:
//   toInsert  — detected fingerprints with NO open row AND not durably dismissed → new open rows
//   toResolve — open rows whose fingerprint is no longer detected → AUTO-RESOLVE (history)
//   toTouch   — open rows still detected → bump last_seen_at
// A DISMISSED fingerprint suppresses re-insert (durable across sessions/devices). So
// does an ATTESTED one (C198·3b f1) — the condition is still in the ledger, so without
// this the very next scan would re-open every note a sign-off just retired. A RESOLVED
// one does NOT: if the condition genuinely recurs, it re-opens as a new event
// (resolved means "was gone" — its return is real news).
export function reconcileAnomalies({ detected = [], rows = [] } = {}) {
  const openByFp = new Map();
  const dismissedFps = new Set();
  for (const r of rows || []) {
    if (!r || !r.fingerprint) continue;
    if (r.status === "open") openByFp.set(r.fingerprint, r);
    else if (r.status === "dismissed") dismissedFps.add(r.fingerprint);
    else if (r.resolution === ANOMALY_RESOLUTION.ATTESTED) dismissedFps.add(r.fingerprint);
  }
  const detectedByFp = new Map();
  for (const d of detected || []) if (d && d.fingerprint) detectedByFp.set(d.fingerprint, d);

  const toInsert = [];
  const toTouch = [];
  for (const [fp, d] of detectedByFp) {
    if (openByFp.has(fp)) toTouch.push(openByFp.get(fp));
    else if (!dismissedFps.has(fp)) toInsert.push(d);
  }
  const toResolve = [];
  for (const [fp, row] of openByFp) if (!detectedByFp.has(fp)) toResolve.push(row);

  return { toInsert, toTouch, toResolve };
}

// ── C198·3b (f1) — ANOMALIES EXPIRE WITH THE MONTH ───────────────────────────
// A reviewer who attested a month has, by that act, judged its low-severity notes
// acceptable. Carrying them into later months is the alarm-fatigue class again: the
// queue fills with notes about periods that are closed, and the reviewer learns to
// scroll past all of it.
//
// Everything at or BEFORE the signed month goes, not just the signed month itself —
// a note about April that survived April's sign-off has been attested over twice by
// the time May closes, and leaving it is the same lie.
//
// HIGH is excluded by design: a HIGH anomaly BLOCKS sign-off (signOffReadiness), so
// it should be resolved or dismissed on its merits, never retired by the act it was
// supposed to prevent. An override can still sign a month with an open HIGH — and
// that HIGH stays open, which is the point.
export function anomaliesExpiredBySignoff(rows = [], period, invoices = []) {
  if (!period) return [];
  return (rows || []).filter((a) => {
    if (!a || a.status !== "open" || isHighAnomaly(a)) return false;
    const subject = anomalySubjectPeriod(a, invoices);
    return !!subject && subject <= String(period);
  });
}

// The inverse. Revoking month M's sign-off re-opens exactly the notes M retired —
// matched on `attested_period`, so a note attested by a DIFFERENT month stays closed.
// Un-attesting has to give back what attesting took, or a revoke would quietly
// launder away every note the month was carrying.
export function anomaliesReopenedByRevoke(rows = [], period) {
  if (!period) return [];
  return (rows || []).filter(
    (a) => a && a.resolution === ANOMALY_RESOLUTION.ATTESTED && String(a.attested_period) === String(period)
  );
}

// ── C195 (3) — PATTERN SUPPRESSION (alarm fatigue) ───────────────────────────
// Live: the identical 4-card Bluebonnet duplicate set was dismissed two months running.
// Fingerprint dedup can't help — a new month's charges are new entries, so a new
// fingerprint. If the reviewer already judged THIS vendor at THIS amount acceptable
// recently, re-raising it at HIGH is noise that trains people to ignore the queue.
//
// Matching uses only columns the table already has (no migration): the dismissed row's
// `title` carries the vendor and its `detail` carries the formatted amount.
const DISMISSAL_WINDOW_DAYS = 60;
const normName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function priorDismissalFor(rows = [], { type = "duplicate_payment", vendor = null, amount = null, now = new Date(), withinDays = DISMISSAL_WINDOW_DAYS } = {}) {
  const v = normName(vendor);
  if (!v) return null;
  const amt = Math.abs(Number(amount) || 0);
  const cutoff = +new Date(now) - withinDays * 86400000;
  for (const r of (rows || [])) {
    if (!r || r.status !== "dismissed" || r.type !== type) continue;
    if (!normName(r.title).includes(v)) continue;                       // same vendor
    if (amt > 0) {
      // the amount as it was rendered into the detail text, e.g. "$145.00"
      const hay = String(r.detail || "");
      const shown = amt.toFixed(2);
      if (!hay.includes(shown)) continue;                               // same amount
    }
    const when = +new Date(r.resolved_at || r.created_at || 0);
    if (Number.isFinite(when) && when >= cutoff) return r;              // and recent enough
  }
  return null;
}

// Downgrade a freshly-detected anomaly the reviewer already dismissed for the same
// vendor+amount recently: severity 'low' + copy that says WHY it's quiet. LOW never blocks
// sign-off (the gate counts HIGH-in-period only — see openHighAnomaliesInPeriod), so this
// keeps the record without re-alarming. Pure.
export function applyPatternSuppression(detected = [], rows = [], { now = new Date(), withinDays = DISMISSAL_WINDOW_DAYS } = {}) {
  return (detected || []).map((d) => {
    if (!d || d.type !== "duplicate_payment") return d;
    const prior = priorDismissalFor(rows, { type: d.type, vendor: d.vendor, amount: d.amount, now, withinDays });
    if (!prior) return d;
    return {
      ...d,
      severity: "low",
      suppressed: true,
      description: `${d.description} You've flagged this before — you confirmed it's a recurring charge, so we're noting it quietly rather than raising it.`,
    };
  });
}

// Map a freshly-detected anomaly → an INSERT row for the `anomalies` table.
export function anomalyInsertRow(companyId, d) {
  return {
    company_id: companyId,
    type: d.type,
    severity: d.severity || "medium",
    status: "open",
    fingerprint: d.fingerprint,
    title: d.title || null,
    detail: d.description || d.detail || null,
    entity_refs: Array.isArray(d.invoice_ids) ? d.invoice_ids : [],
  };
}
