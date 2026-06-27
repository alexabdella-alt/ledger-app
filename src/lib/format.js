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

export { initials, vendorColor, fmtDate, fmtSignedMoney };
