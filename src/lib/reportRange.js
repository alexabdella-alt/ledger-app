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
// ★ C716 — "Year to date" and the quarters follow the company's FISCAL year (`fiscalYearEnd`,
// "MM-DD"). They were calendar-only, so a July–June company's "Year to date" P&L covered January
// on while its balance sheet's "net income this year" started in July — two years on one screen.
export function reportRangeBounds(range, now = new Date(), { fiscalYearEnd = "12-31" } = {}) {
  const y = now.getFullYear(), m = now.getMonth() + 1;
  // (year, month) moved by k months
  const shift = (yy, mm, k) => { const t = (yy * 12 + (mm - 1)) + k; return [Math.floor(t / 12), (t % 12) + 1]; };
  const first = (yy, mm) => { const [a, b] = shift(yy, mm, 0); return `${a}-${pad(b)}-01`; };
  const lastOf = (yy, mm) => { const [a, b] = shift(yy, mm, 0); return `${a}-${pad(b)}-${pad(new Date(a, b, 0).getDate())}`; };
  const fyeMonth = Math.min(12, Math.max(1, Number(String(fiscalYearEnd || "12-31").split("-")[0]) || 12));
  const startMonth = (fyeMonth % 12) + 1;
  const startYear = m >= startMonth ? y : y - 1;
  const quarter = (q) => { const [fy, fm] = shift(startYear, startMonth, 3 * (q - 1)); const [ly, lm] = shift(fy, fm, 2); return { from: first(fy, fm), to: lastOf(ly, lm) }; };
  switch (range) {
    case "thismonth": return { from: first(y, m), to: lastOf(y, m) };
    case "lastmonth": { const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1; return { from: first(py, pm), to: lastOf(py, pm) }; }
    case "q1": return quarter(1);
    case "q2": return quarter(2);
    case "q3": return quarter(3);
    case "q4": return quarter(4);
    case "ytd": { const [ey, em] = shift(startYear, startMonth, 11); return { from: first(startYear, startMonth), to: lastOf(ey, em) }; }
    default: return null;   // "all" and unknown ranges: no bounds
  }
}

// ★ C645 — THE DATES A RANGE CHOICE SETS, so the balance sheet's "as of" follows the picker.
// Choosing "Last month" or a quarter set no dates at all, so the balance sheet — which reads the
// END date — stayed "as of" today (or an old custom date) beside a picker reading "Last month".
// The end is capped at today: a balance sheet "as of December 31" in November would be a date
// that hasn't happened. "all" clears both; "custom" (and anything unknown) leaves them alone.
export function reportRangeDates(range, now = new Date(), { fiscalYearEnd = "12-31" } = {}) {
  if (range === "all") return { from: "", to: "" };
  const b = reportRangeBounds(range, now, { fiscalYearEnd });
  if (!b) return null;
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return { from: b.from, to: b.to < today ? b.to : today };
}

export function inReportRange(dateStr, range, { now = new Date(), from = null, to = null, fiscalYearEnd = "12-31" } = {}) {
  const p = ymd(dateStr);
  if (!p) return false;
  if (range === "all") return true;
  if (range === "custom") {
    const f = ymd(from)?.d, t = ymd(to)?.d;
    return (!f || p.d >= f) && (!t || p.d <= t);
  }
  const b = reportRangeBounds(range, now, { fiscalYearEnd });
  if (!b) return true;
  return p.d >= b.from && p.d <= b.to;
}
