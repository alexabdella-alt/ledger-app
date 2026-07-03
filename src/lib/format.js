function initials(name) {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
}
function vendorColor(name) {
  const colors = ["#6D28D9","#0EA5E9","#10B981","#F59E0B","#EF4444","#8B5CF6","#EC4899","#14B8A6"];
  let hash = 0;
  for (let i = 0; i < (name||"").length; i++) hash = name.charCodeAt(i) + ((hash<<5)-hash);
  return colors[Math.abs(hash) % colors.length];
}

// Readable date format used across the app: "Jun 7, 2026" (Mercury/Stripe-style).
// Accepts Date objects, ISO strings, or date-only "YYYY-MM-DD" strings. Date-only
// strings are pinned to local noon so a timezone offset never shifts the day.
function fmtDate(d, opts) {
  if (d == null || d === "") return "";
  let date;
  if (d instanceof Date) date = d;
  else {
    const s = String(d).trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
    else date = new Date(s);
  }
  if (!date || isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString("en-US", opts || { month: "short", day: "numeric", year: "numeric" });
}

// ─────────────────────────────────────────────────────────────────────────────
// THE ONE canonical money formatter. Every monetary value displayed anywhere in
// the app (dashboard cards, chatbot tool figures, reports, books, exec summary,
// notifications) must go through this — never an ad-hoc `"$"+Math.round(n)` or
// `toLocaleString({maximumFractionDigits:0})`. Ad-hoc formatters were the root of
// the "$1 off" class of bugs: one canonical VALUE (glCash etc.) rendered by two
// different formatters (round-half-up whole dollars vs exact cents) disagreed by
// $1 and could never reconcile. One value + one formatter = every surface matches
// to the penny, by construction. (Guarded by tests/moneyFormatterCanonical.test.js.)
//
//   fmtSignedMoney(n)                       → "$1,234.50" / "-$786.50"  (default: cents, signed)
//   fmtSignedMoney(n, { signed: false })    → "$1,234.50" / "$786.50"   (magnitude — for
//                                             surfaces that convey sign via color/parens)
//   fmtSignedMoney(n, { decimals: 0 })      → "$1,235" / "-$787"        (documented WHOLE-DOLLAR
//                                             variant — ONLY for forward-looking estimates, e.g.
//                                             "est. ~$1,235 quarterly tax", never a real balance)
//
// A negative balance (overdrawn cash) MUST render with its sign in the default —
// never as a positive magnitude, which would mask an overdraft and overstate
// assets (the Balance Sheet sign-flip bug).
function fmtSignedMoney(n, { decimals = 2, signed = true } = {}) {
  const v = Number(n) || 0;
  const body = "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (signed && v < 0) ? "-" + body : body;
}
// Magnitude cents (drops sign — the dominant view-table convention, sign via color).
const fmtMoney = (n) => fmtSignedMoney(n, { signed: false });
// Whole-dollar, for forward-looking ESTIMATES only (a documented variant, not a
// second formatter). Signed so a projected loss still reads with its sign.
const fmtApprox = (n) => fmtSignedMoney(n, { decimals: 0 });

// Payment terms → net days (O11). "Net 30" → 30, "Due on receipt"/"COD" → 0, "45 days" → 45,
// "2/10 Net 30" (early-pay discount) → the net term (30). Returns null when unparseable so the
// caller leaves due_date empty rather than guessing.
function termsToDays(terms) {
  if (terms == null) return null;
  const t = String(terms).toLowerCase().trim();
  if (!t) return null;
  if (/(due on receipt|on receipt|^cod$|cash on delivery|immediate|due immediately|prepaid|paid)/.test(t)) return 0;
  const net = t.match(/net\s*(\d{1,3})/);
  if (net) return parseInt(net[1], 10);
  const days = t.match(/\b(\d{1,3})\s*days?\b/);
  if (days) return parseInt(days[1], 10);
  return null;
}

// Derive a due date (YYYY-MM-DD) from an issue date + payment terms. Null if terms don't
// parse or the date is invalid — never invents a due date without a basis.
function deriveDueDate(issueDate, terms) {
  const days = termsToDays(terms);
  if (days == null || !issueDate) return null;
  const s = String(issueDate).trim();
  const d = new Date(s.length <= 10 ? s + "T12:00:00" : s);
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return ymdLocal(d);
}

// Format any Date to a LOCAL calendar YYYY-MM-DD. Use for any date key that
// determines a PERIOD (which month/day a figure lands in) — NEVER toISOString(),
// which is UTC and day-shifts near midnight for non-UTC users (the C129/F-1 class).
const ymdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Add k whole months to a YYYY-MM-DD, keeping the day-of-month but CLAMPING to the
// target month's last day (Jan 31 +1mo → Feb 28/29, never overflow to Mar 3), and
// formatting from LOCAL components (no UTC day-shift). For amortization / depreciation
// schedules where each period is one calendar month from the in-service date (CR-4).
const addMonthsClampedYMD = (startYMD, k) => {
  const m = String(startYMD || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(startYMD || "");
  const y = +m[1], mo = +m[2] - 1, day = +m[3];
  const lastDay = new Date(y, mo + k + 1, 0).getDate();   // 0th of next month = last day of target month
  return ymdLocal(new Date(y, mo + k, Math.min(day, lastDay)));
};

// Today's calendar date as YYYY-MM-DD from LOCAL components — NEVER toISOString() (UTC),
// which for a user behind UTC can roll into the next day (and, on a month boundary, the next
// PERIOD). Every WRITE-PATH entry-date fallback uses this so an evening booking/void doesn't
// silently land in the wrong month. (Local-component twin of C129's ymLocal.)
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export { initials, vendorColor, fmtDate, fmtSignedMoney, fmtMoney, fmtApprox, termsToDays, deriveDueDate, todayLocal, ymdLocal, addMonthsClampedYMD };
