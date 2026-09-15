// ─────────────────────────────────────────────────────────────────────────────
// C440 — WHICH ENTRIES A REPORT RANGE COVERS, DECIDED ON THE DATE STRING.
//
// `ReportsView` built `new Date(inv.date)` and read `.getMonth()`. A `YYYY-MM-DD` string
// parses as UTC MIDNIGHT, and in every US timezone that instant is the evening BEFORE — so
// `new Date("2026-09-01").getMonth()` is 7 (August) from Chicago. Every first-of-month
// entry fell into the previous month on "This month", "Last month" and each quarter, and
// rent — dated the 1st — moved months on every report. Not a display slip: the P&L, the
// Balance Sheet's period figures and C379's paragraph all read `filtered`. C290 swept the
// date HELPERS and recorded the rule; this filter never used them.
//
// Pure. Compares the string's own YYYY-MM-DD parts, so the zone cannot matter.
// ─────────────────────────────────────────────────────────────────────────────
const ymd = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "").trim()); return m ? { y: Number(m[1]), m: Number(m[2]), d: m[0] } : null; };
const pad = (n) => String(n).padStart(2, "0");

// `now` is a Date (local); the range is computed from its LOCAL year and month.
export function reportRangeBounds(range, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth() + 1;
  const first = (yy, mm) => `${yy}-${pad(mm)}-01`;
  const lastOf = (yy, mm) => `${yy}-${pad(mm)}-${pad(new Date(yy, mm, 0).getDate())}`;
  switch (range) {
    case "thismonth": return { from: first(y, m), to: lastOf(y, m) };
    case "lastmonth": { const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1; return { from: first(py, pm), to: lastOf(py, pm) }; }
    case "q1": return { from: first(y, 1), to: lastOf(y, 3) };
    case "q2": return { from: first(y, 4), to: lastOf(y, 6) };
    case "q3": return { from: first(y, 7), to: lastOf(y, 9) };
    case "q4": return { from: first(y, 10), to: lastOf(y, 12) };
    case "ytd": return { from: first(y, 1), to: lastOf(y, 12) };
    default: return null;   // "all" and unknown ranges: no bounds
  }
}

export function inReportRange(dateStr, range, { now = new Date(), from = null, to = null } = {}) {
  const p = ymd(dateStr);
  if (!p) return false;
  if (range === "all") return true;
  if (range === "custom") {
    const f = ymd(from)?.d, t = ymd(to)?.d;
    return (!f || p.d >= f) && (!t || p.d <= t);
  }
  const b = reportRangeBounds(range, now);
  if (!b) return true;
  return p.d >= b.from && p.d <= b.to;
}
