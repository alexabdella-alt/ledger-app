// ─────────────────────────────────────────────────────────────────────────────
// Depreciation (#8) — straight-line. Pure builders so the schedule is deterministic
// and unit-tested, then posted through the canonical multi-line write path.
//
//   Each period:  Dr Depreciation Expense (6900)  /  Cr Accumulated Depreciation (1510)
//
// Depreciable base = cost − salvage. Straight-line monthly = base / useful-life-months.
// The LAST month absorbs any rounding remainder so Σ(schedule) === base to the cent
// (accumulated depreciation lands exactly at the depreciable base, never drifts).
//
// Variants deliberately deferred (see CLAUDE.md §11): declining-balance,
// units-of-production, and MACRS. Straight-line is the common-case standard.
// ─────────────────────────────────────────────────────────────────────────────

import { buildJournalEntry } from "./journalEntries.js";
import { addMonthsClampedYMD, todayLocal } from "./format.js";

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// Suggested straight-line useful life (months) from the asset description — the
// "AI-suggested default" the user confirms or overrides. Standard conventions:
// buildings 39yr, vehicles 5yr, computers/tech 5yr, furniture/equipment 7yr,
// everything else 5yr. Order matters (most specific first).
export function suggestUsefulLifeMonths(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(building|real estate|warehouse|property)\b/.test(t)) return 468;          // 39 yr
  if (/\b(vehicle|truck|\bcar\b|van|auto|automobile|fleet|forklift)\b/.test(t)) return 60;  // 5 yr
  if (/\b(computer|laptop|macbook|desktop|server|monitor|phone|tablet|ipad|software|printer|camera|electronics?|hardware|router)\b/.test(t)) return 60; // 5 yr
  if (/\b(furniture|desk|chair|cabinet|shelv|equipment|machinery|machine|appliance|fixture|tool|hvac)\b/.test(t)) return 84; // 7 yr
  return 60;                                                                          // default 5 yr
}

// Pure planner for "run depreciation through DATE": given ALL pending schedule rows
// and a cutoff, return the rows to post (due on/before the cutoff, date-ordered) and
// the asset ids that become fully depreciated (every one of their pending rows is in
// this run). The handler posts `due` and flips `assetsToFlip`. Deterministic/testable.
export function planDepreciationRun(scheduleRows, throughDate) {
  const rows = (scheduleRows || []).filter(r => r && r.status === "pending");
  const cutoff = String(throughDate || "");
  const due = rows
    .filter(r => String(r.period_date) <= cutoff)
    .sort((a, b) => String(a.period_date).localeCompare(String(b.period_date)) || (a.period_index - b.period_index));
  const pendingByAsset = {};
  rows.forEach(r => { pendingByAsset[r.asset_id] = (pendingByAsset[r.asset_id] || 0) + 1; });
  const dueByAsset = {};
  due.forEach(r => { dueByAsset[r.asset_id] = (dueByAsset[r.asset_id] || 0) + 1; });
  const assetsToFlip = Object.keys(dueByAsset).filter(a => dueByAsset[a] === pendingByAsset[a]);
  return { due, assetsToFlip };
}

// O10 — how many depreciation months are DUE but not yet posted as of `asOf`: pending
// schedule rows dated on/before today. Surfaces the "depreciation is due" nudge so the
// user runs it (we never auto-post). Returns { count, throughDate, assets }. Pure.
export function depreciationDue(scheduleRows, asOf = null) {
  const today = asOf || todayLocal();   // period boundary (which rows are due) — local, not UTC
  const due = (scheduleRows || []).filter(r => r && r.status === "pending" && String(r.period_date || "") <= today);
  const throughDate = due.reduce((mx, r) => (String(r.period_date) > mx ? String(r.period_date) : mx), "");
  const assets = new Set(due.map(r => r.asset_id)).size;
  return { count: due.length, throughDate, assets };
}

// Cost less salvage, floored at 0.
export function depreciableBase(cost, salvage = 0) {
  return Math.max(0, r2(r2(cost) - r2(salvage)));
}

// GL-TRUTH idempotency: has this asset+period ALREADY been posted? A depreciation entry stamps
// import_metadata { kind:"depreciation", asset_id, period }. We derive "posted" from a LIVE JE
// in the ledger, NOT the schedule's status flag (which can drift) — so auto-post can never
// double-post a period even if the flag is wrong.
export function depreciationAlreadyPosted(ledger, assetId, periodIndex) {
  return (ledger || []).some(i => {
    const m = i && i.import_metadata;
    return m && m.kind === "depreciation"
      && String(m.asset_id) === String(assetId)
      && Number(m.period) === Number(periodIndex)
      && i.status !== "voided" && i.status !== "deleted";
  });
}

// AUTO-POST planner. Depreciation is deterministic (cost·life·method·start fix the amount), so
// due periods post themselves — no human nudge. Partition schedule rows (as-of throughDate):
//   post       → DUE (period_date ≤ throughDate), COMPLETE (amount>0), and NOT already in the GL
//   skipped    → DUE but a live depreciation JE already exists (GL-truth) → idempotent no-op
//   incomplete → DUE but ambiguous/malformed (no amount, no asset/period) → DO NOT guess; flag
// `assetsToFlip` = assets whose EVERY input row will be posted this run (→ fully_depreciated).
export function planDepreciationAutoPost(scheduleRows, ledger, throughDate) {
  const cutoff = String(throughDate || todayLocal());   // "run through today" — local period boundary
  const post = [], skipped = [], incomplete = [];
  for (const r of (scheduleRows || [])) {
    if (!r) continue;
    if (String(r.period_date || "") > cutoff) continue;                 // not due yet — never post early
    if (r.asset_id == null || r.period_index == null) { incomplete.push(r); continue; }
    if (depreciationAlreadyPosted(ledger, r.asset_id, r.period_index)) { skipped.push(r); continue; }
    if (!(Number(r.amount) > 0)) { incomplete.push(r); continue; }      // ambiguous amount → don't guess
    post.push(r);
  }
  // Flip an asset only if ALL of its (input) rows are being posted this run — an incomplete
  // row for that asset blocks the flip (we didn't finish it).
  const totalByAsset = {}, postByAsset = {}, incByAsset = {};
  (scheduleRows || []).forEach(r => { if (r && r.asset_id != null) totalByAsset[r.asset_id] = (totalByAsset[r.asset_id] || 0) + 1; });
  post.forEach(r => { postByAsset[r.asset_id] = (postByAsset[r.asset_id] || 0) + 1; });
  incomplete.forEach(r => { if (r.asset_id != null) incByAsset[r.asset_id] = (incByAsset[r.asset_id] || 0) + 1; });
  const assetsToFlip = Object.keys(postByAsset).filter(a => !incByAsset[a] && postByAsset[a] === totalByAsset[a]);
  return { post, skipped, incomplete, assetsToFlip };
}

// One period's depreciation entry (Dr Dep Exp / Cr Accum Dep), as a buildJournalEntry
// result routed through persistMultiLineEntry. Null if the amount/accounts are invalid.
export function buildDepreciationEntry({ amount, depExpCode, accumDepCode, date = null, description = "Depreciation", memo = null, meta = null } = {}) {
  const amt = r2(amount);
  if (!(amt > 0) || !depExpCode || !accumDepCode) return null;
  return buildJournalEntry({
    lines: [
      { code: depExpCode, debit: amt, credit: 0 },     // Dr Depreciation Expense
      { code: accumDepCode, debit: 0, credit: amt },   // Cr Accumulated Depreciation
    ],
    date, description, source: "depreciation", memo, meta,
  });
}

// The full straight-line schedule: one entry per month over the useful life, starting
// at inServiceDate. Returns { entries, total, monthly, months }. `total` === the
// depreciable base exactly (last month absorbs the rounding remainder).
// ── METHODS BEYOND STRAIGHT-LINE ─────────────────────────────────────────────
// §12 listed these as a DELIBERATE deferral — "known, not silently missing" — with the
// industry-standard case built first. Straight-line remains the default and nothing about it
// changes; these are additive.
//
// ★★ ALL THREE PRODUCE A SCHEDULE THAT SUMS EXACTLY TO COST − SALVAGE. That is the invariant
// that makes a method safe to add: an asset must be fully written down to its salvage value
// and never past it, whatever curve it takes to get there. A method that over-depreciates
// writes off value the business still owns; one that under-depreciates leaves a stub nobody
// notices. **The last period absorbs rounding in every method, for the same reason.**
export const DEPRECIATION_METHOD = {
  STRAIGHT_LINE: "straight_line",
  DECLINING_BALANCE: "declining_balance",   // double-declining, with the standard switch
  UNITS_OF_PRODUCTION: "units_of_production",
};

// Per-period amounts for a method. Pure arithmetic — no dates, no accounts — so the shape of
// the curve is testable on its own, separately from how it is posted.
export function depreciationAmounts({ method = DEPRECIATION_METHOD.STRAIGHT_LINE, base = 0, periods = 0, rate = 2, unitsPerPeriod = [], totalUnits = 0 } = {}) {
  const n = Math.max(0, Math.floor(Number(periods) || 0));
  const b = r2(Number(base) || 0);
  if (!(b > 0) || n === 0) return [];

  if (method === DEPRECIATION_METHOD.UNITS_OF_PRODUCTION) {
    // ★ USAGE-BASED, SO IT NEEDS THE USAGE. A machine that ran 40% of its expected hours has
    // used 40% of its life; without the numbers there is nothing to compute and guessing a
    // curve would be inventing the thing the method exists to measure.
    const total = Number(totalUnits) || (unitsPerPeriod || []).reduce((s, u) => s + (Number(u) || 0), 0);
    if (!(total > 0)) return [];
    const out = [];
    let posted = 0;
    for (let k = 0; k < n; k++) {
      const units = Number((unitsPerPeriod || [])[k]) || 0;
      const amt = k === n - 1 ? r2(b - posted) : r2((b * units) / total);
      posted = r2(posted + amt);
      out.push(amt);
    }
    return out;
  }

  if (method === DEPRECIATION_METHOD.DECLINING_BALANCE) {
    // Double-declining on the NET BOOK VALUE, with the standard switch to straight-line over
    // the remaining periods once that is the larger figure.
    //
    // ★★ THE SWITCH IS NOT AN OPTIMISATION — WITHOUT IT THE ASSET NEVER FINISHES. Declining
    // balance takes a fraction of what is left each period, so it approaches zero and never
    // arrives; the schedule would end with a stub still on the books. Every textbook makes
    // this switch for exactly that reason.
    const r = (Number(rate) || 2) / n;
    const out = [];
    let remaining = b;
    for (let k = 0; k < n; k++) {
      const left = n - k;
      const declining = r2(remaining * r);
      const straight = r2(remaining / left);
      const amt = k === n - 1 ? r2(remaining) : Math.max(declining, straight);
      remaining = r2(remaining - amt);
      out.push(amt);
    }
    return out;
  }

  // Straight line — unchanged, and the default for anything unrecognised. A method name we
  // do not know must not silently produce a different curve.
  const per = r2(b / n);
  const out = [];
  let posted = 0;
  for (let k = 0; k < n; k++) {
    const amt = k === n - 1 ? r2(b - posted) : per;
    posted = r2(posted + amt);
    out.push(amt);
  }
  return out;
}

export function buildDepreciationSchedule({ cost, salvage = 0, lifeMonths, inServiceDate, depExpCode, accumDepCode, assetLabel = "asset", assetId = null } = {}) {
  const base = depreciableBase(cost, salvage);
  const n = Math.max(0, Math.floor(Number(lifeMonths) || 0));
  if (!(base > 0) || n === 0 || !inServiceDate || !depExpCode || !accumDepCode) {
    return { entries: [], total: 0, monthly: 0, months: 0 };
  }
  const perMonth = r2(base / n);
  const entries = [];
  let posted = 0;
  for (let k = 0; k < n; k++) {
    // Month k from the in-service date, day clamped to the month + LOCAL-formatted
    // (CR-4: Jan 31 +1mo → Feb 28, never overflow to Mar 3; no toISOString day-shift).
    const isLast = k === n - 1;
    const amt = isLast ? r2(base - posted) : perMonth;   // last month absorbs rounding
    posted = r2(posted + amt);
    const je = buildDepreciationEntry({
      amount: amt, depExpCode, accumDepCode,
      date: addMonthsClampedYMD(inServiceDate, k),
      description: `Depreciation — ${assetLabel} (${k + 1}/${n})`,
      meta: { kind: "depreciation", asset_id: assetId != null ? String(assetId) : null, period: k + 1, of: n },
    });
    // ★ A ZERO-AMOUNT MONTH IS NOT A SCHEDULE ROW. `buildDepreciationEntry` returns null when
    // the amount rounds to nothing — which happens for a sub-dollar asset over a long life,
    // where per-month is under half a cent. Pushing that null put a HOLE in the array, and
    // both consumers walk it directly (`persistMultiLineEntry(je)` and a `.map(je => je.…)`),
    // so the schedule would have thrown rather than degraded. The correct schedule for such an
    // asset is one real entry in the final month, which is exactly what this produces.
    if (je) entries.push(je);
  }
  return { entries, total: r2(posted), monthly: perMonth, months: n };
}
