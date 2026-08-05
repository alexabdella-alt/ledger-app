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

// The linked journal-entry ids for an anomaly, from either shape (persisted row's
// `entity_refs` or a freshly-detected anomaly's `invoice_ids`).
function refIds(anomaly) {
  if (!anomaly) return [];
  if (Array.isArray(anomaly.entity_refs)) return anomaly.entity_refs;
  if (Array.isArray(anomaly.invoice_ids)) return anomaly.invoice_ids;
  return [];
}

// Does this anomaly touch the given sign-off period (YYYY-MM)? Entry-linked anomalies
// resolve their refs → dates via the invoices array. Aggregate anomalies (e.g.
// category_spike, which carries no entry refs) encode the month in the fingerprint
// tail (`…:YYYY-MM`) — fall back to that so a month-scoped spike still period-gates.
export function anomalyTouchesPeriod(anomaly, period, invoices = []) {
  if (!anomaly || !period) return false;
  const refs = refIds(anomaly);
  if (!refs.length) {
    const m = /:(\d{4}-\d{2})$/.exec(String(anomaly.fingerprint || anomaly.id || ""));
    return m ? m[1] === period : false;
  }
  const byId = new Map((invoices || []).map((i) => [String(i.id), i]));
  return refs.some((r) => {
    const inv = byId.get(String(r));
    return !!inv && String(inv.date || "").slice(0, 7) === period;
  });
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
// A DISMISSED fingerprint suppresses re-insert (durable across sessions/devices). A
// RESOLVED one does NOT: if the condition genuinely recurs, it re-opens as a new event
// (resolved means "was gone" — its return is real news).
export function reconcileAnomalies({ detected = [], rows = [] } = {}) {
  const openByFp = new Map();
  const dismissedFps = new Set();
  for (const r of rows || []) {
    if (!r || !r.fingerprint) continue;
    if (r.status === "open") openByFp.set(r.fingerprint, r);
    else if (r.status === "dismissed") dismissedFps.add(r.fingerprint);
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
