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
  const today = asOf || new Date().toISOString().slice(0, 10);
  const due = (scheduleRows || []).filter(r => r && r.status === "pending" && String(r.period_date || "") <= today);
  const throughDate = due.reduce((mx, r) => (String(r.period_date) > mx ? String(r.period_date) : mx), "");
  const assets = new Set(due.map(r => r.asset_id)).size;
  return { count: due.length, throughDate, assets };
}

// Cost less salvage, floored at 0.
export function depreciableBase(cost, salvage = 0) {
  return Math.max(0, r2(r2(cost) - r2(salvage)));
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
export function buildDepreciationSchedule({ cost, salvage = 0, lifeMonths, inServiceDate, depExpCode, accumDepCode, assetLabel = "asset", assetId = null } = {}) {
  const base = depreciableBase(cost, salvage);
  const n = Math.max(0, Math.floor(Number(lifeMonths) || 0));
  if (!(base > 0) || n === 0 || !inServiceDate || !depExpCode || !accumDepCode) {
    return { entries: [], total: 0, monthly: 0, months: 0 };
  }
  const perMonth = r2(base / n);
  const start = new Date(String(inServiceDate) + "T12:00:00");
  const entries = [];
  let posted = 0;
  for (let k = 0; k < n; k++) {
    const dt = new Date(start.getFullYear(), start.getMonth() + k, start.getDate());
    const isLast = k === n - 1;
    const amt = isLast ? r2(base - posted) : perMonth;   // last month absorbs rounding
    posted = r2(posted + amt);
    entries.push(buildDepreciationEntry({
      amount: amt, depExpCode, accumDepCode,
      date: dt.toISOString().slice(0, 10),
      description: `Depreciation — ${assetLabel} (${k + 1}/${n})`,
      meta: { kind: "depreciation", asset_id: assetId != null ? String(assetId) : null, period: k + 1, of: n },
    }));
  }
  return { entries, total: r2(posted), monthly: perMonth, months: n };
}
