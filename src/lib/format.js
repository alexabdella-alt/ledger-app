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

// Signed money: "$1,234.50" / "-$786.50". A negative balance (e.g. an overdrawn
// cash account) MUST render with its sign — never as a positive magnitude, which
// would mask an overdraft and overstate assets (the Balance Sheet sign-flip bug).
function fmtSignedMoney(n, { decimals = 2 } = {}) {
  const v = Number(n) || 0;
  const body = "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return v < 0 ? "-" + body : body;
}

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
  return d.toISOString().slice(0, 10);
}

// Today's calendar date as YYYY-MM-DD from LOCAL components — NEVER toISOString() (UTC),
// which for a user behind UTC can roll into the next day (and, on a month boundary, the next
// PERIOD). Every WRITE-PATH entry-date fallback uses this so an evening booking/void doesn't
// silently land in the wrong month. (Local-component twin of C129's ymLocal.)
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export { initials, vendorColor, fmtDate, fmtSignedMoney, termsToDays, deriveDueDate, todayLocal };
