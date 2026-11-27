// ═════════════════════════════════════════════════════════════════════════════
// ★ C779 — "WERE THESE PERSONAL?": SORTING A MIXED ACCOUNT IN ONE TAP A WEEK.
//
// The people this app is for use one card for everything. Their personal spending lands in the books
// as business expenses, the profit looks smaller than it is, and tax is under-counted. Asking them to
// open a separate account is right (and the card says so once) but most won't — so the app does the
// sorting with them instead: charges that LOOK personal (streaming, groceries, food delivery, gyms…)
// are gathered into one short list; one tap records the ticked ones as money the owner took out
// (Owner's Draw — never spending), and the unticked ones stay business.
//
// ★★ EVERY ANSWER IS REMEMBERED, SO THE LIST SHRINKS TO NOTHING. Each answer saves a rule for that
// vendor (personal → Owner's Draw; business → the category it is in), so the next Netflix books
// itself and is never asked again. A vendor that already has a rule is the owner's decision and is
// never listed.
//
// ★ IT IS A QUESTION, NEVER AN AUTOMATIC MOVE. For a content creator Netflix and Starbucks can be
// genuine business costs; only the owner knows. Nothing moves until they tap.
//
// ★ A BATCH, NOT A DRIP: the card appears once there are a few to sort or the oldest has waited a
// week — a small weekly habit rather than a nag on every charge. Pure.
// ═════════════════════════════════════════════════════════════════════════════
import { glIsExpense, isReversalEntry } from "./gl.js";
import { settlementKind, perEntry } from "./txnPresent.js";
import { daysBetween } from "./toldPurchase.js";

export const PERSONAL_BATCH_MIN = 3;      // show once this many are waiting…
export const PERSONAL_WAIT_DAYS = 7;      // …or the oldest has waited a week
export const PERSONAL_LOOKBACK_DAYS = 90; // older charges aren't chased
export const PERSONAL_SHOW = 10;          // one short list at a time

// The everyday personal kinds, by the words a bank or card statement prints. Kept to the obvious ones:
// a false hit costs the owner one untick, a missed one only means it isn't asked.
export const PERSONAL_HINTS = [
  { kind: "streaming", re: /\b(netflix|hulu|disney\s*\+|disneyplus|spotify|apple\s*music|hbo|max\.com|peacock|paramount\s*\+|youtube\s*premium|sirius\s*xm)\b/i },
  { kind: "groceries", re: /\b(kroger|h-?e-?b|whole\s*foods|trader\s*joe|safeway|publix|aldi|wegmans|sprouts|food\s*lion|giant\s*eagle|meijer|instacart)\b/i },
  { kind: "food delivery", re: /\b(uber\s*eats|doordash|door\s*dash|grubhub|postmates|seamless)\b/i },
  { kind: "coffee and fast food", re: /\b(starbucks|dunkin|mcdonald'?s|chick-?fil-?a|taco\s*bell|wendy'?s|chipotle|sonic\s*drive|whataburger|panera)\b/i },
  { kind: "gym and personal care", re: /\b(planet\s*fitness|equinox|orangetheory|24\s*hour\s*fitness|la\s*fitness|crunch\s*fitness|great\s*clips|supercuts|ulta|sephora)\b/i },
  { kind: "pharmacy", re: /\b(cvs|walgreens|rite\s*aid)\b/i },
  { kind: "entertainment", re: /\b(amc\s*theat|regal\s*cinema|ticketmaster|stubhub|steam\s*games|playstation|xbox|nintendo)\b/i },
];

export function personalKind(text = "") {
  const t = String(text || "");
  if (!t.trim()) return null;
  const hit = PERSONAL_HINTS.find((h) => h.re.test(t));
  return hit ? hit.kind : null;
}

const vkey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const isLive = (e) => !!e && !e.deleted_at && e.status !== "voided" && e.status !== "deleted";

// The charges to ask about: live spending entries in the last 90 days that look personal, whose vendor
// has no rule yet (a rule is the owner's answer). Newest first. Each: { entry, entryId, vendor, amount, date, kind }.
export function personalCandidates({ invoices = [], rules = [], today = "", lookbackDays = PERSONAL_LOOKBACK_DAYS } = {}) {
  const ruled = new Set((rules || []).map((r) => vkey(r && r.vendor)).filter(Boolean));
  const out = [];
  for (const e of perEntry(invoices || [])) {
    if (!isLive(e) || isReversalEntry(e) || e.reversed_by || settlementKind(e)) continue;
    if (e.import_metadata?.kind || e.source === "opening_balance" || e.source === "payroll") continue;
    if (!glIsExpense(String(e.gl_code || "")) || e.debit_credit === "credit") continue;
    const kind = personalKind(`${e.vendor || ""} ${e.description || ""}`);
    if (!kind) continue;
    if (ruled.has(vkey(e.vendor))) continue;
    const age = today ? daysBetween(e.date, today) : 0;
    if (age == null || age > lookbackDays || age < 0) continue;
    out.push({ entry: e, entryId: String(e.db_entry_id ?? e.id), vendor: e.vendor || e.description || "A charge", amount: Number(e.amount) || 0, date: e.date, kind, age });
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// Show the card now? A few waiting, or the oldest has waited a week.
export function personalSortDue(items = []) {
  if (!items.length) return false;
  return items.length >= PERSONAL_BATCH_MIN || items.some((i) => (i.age || 0) >= PERSONAL_WAIT_DAYS);
}

// What the owner's answer will write: the personal ones move to Owner's Draw and each of their vendors
// gets a rule to it; the business ones stay where they are and each of their vendors gets a rule to its
// current category. A vendor answered both ways in one batch counts as business (the safer reading for
// the books: the expense stays, and it is asked no more). Pure.
export function personalSortPlan(items = [], personalIds = new Set(), drawAccount = null) {
  const personal = [], business = [];
  for (const it of items || []) (personalIds.has(it.entryId) ? personal : business).push(it);
  const bizVendors = new Map();
  for (const it of business) if (!bizVendors.has(vkey(it.vendor))) bizVendors.set(vkey(it.vendor), { vendor: it.vendor, gl_code: String(it.entry.gl_code), gl_name: it.entry.gl_name || null });
  const persVendors = new Map();
  for (const it of personal) if (!bizVendors.has(vkey(it.vendor)) && !persVendors.has(vkey(it.vendor)) && drawAccount) persVendors.set(vkey(it.vendor), { vendor: it.vendor, gl_code: String(drawAccount.code), gl_name: drawAccount.name });
  return { move: drawAccount ? personal.map((i) => i.entry) : [], rules: [...persVendors.values(), ...bizVendors.values()], personalCount: personal.length, businessCount: business.length };
}

export const PERSONAL_SORT_COPY = {
  title: (n) => `Were ${n === 1 ? "this" : "these"} personal?`,
  sub: "They look like everyday personal spending. Untick anything that was for the business, then save — we'll remember each one, so you're only asked once.",
  save: (n) => (n ? `Save — ${n} personal` : "Save — all business"),
  separate: "Tip: a separate free checking account just for the business makes this list disappear — and makes taxes much simpler.",
  done: (p, b) => `Saved: ${p} personal (counted as money you took out)${b ? `, ${b} kept as business` : ""}. We'll remember these.`,
};
