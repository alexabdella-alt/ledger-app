// ═════════════════════════════════════════════════════════════════════════════
// C755 — "I JUST BOUGHT IT, RECEIPT LATER": PURCHASES TOLD TO THE ASSISTANT, AND RECEIPTS TO ADD.
//
// The owner tells the assistant "just paid $86 at Home Depot for shelving, I'll send the receipt
// later". The assistant asks only what it can't tell, shows one card, and on Confirm the purchase
// is recorded — marked `told` and `receipt_to_come`. Three things then keep the books right and
// the owner's effort near zero:
//   (1) it is NEVER COUNTED TWICE. If the bank or card statement already holds it, the card says
//       so and Confirm only marks that entry "receipt to come" (`existingToldMatch`). When the
//       statement arrives later, its line is recognised as this purchase even when the bank's date
//       is a few days off (`markAlreadyBooked`'s second pass, openingBalanceProposal.js). When the
//       receipt is uploaded later, it is filed WITH the purchase, not booked again
//       (invoicePayment.js treats a told purchase as already paid).
//   (2) the receipts worth chasing are listed on Home (`receiptsToAdd`) — every told purchase, and
//       recent spending of $75 or more with nothing attached (the IRS generally wants a receipt
//       from $75; below that the bank record and a note of what it was for usually do). One tap
//       adds the photo; "I don't have one" clears it.
//   (3) it is all derived from the ledger and the document library — a receipt attached anywhere
//       (Home, the entry itself, a later upload) takes the line off the list. No flag to go stale.
// Pure — the screen, the confirm card and the executor all read these.
// ═════════════════════════════════════════════════════════════════════════════
import { glIsExpense, entryBaseOf, isReversalEntry } from "./gl.js";
import { settlementKind, perEntry } from "./txnPresent.js";
import { linkedDocIds, hasSourceDoc } from "./sourceDoc.js";
import { fmtMoney, fmtDate } from "./format.js";
import { OWN_MONEY } from "./payFrom.js";

export const RECEIPT_THRESHOLD = 75;          // IRS: a receipt is generally needed from $75
export const RECENT_DAYS = 60;                // older bank spending isn't chased — too late to find
export const TOLD_MATCH_BEFORE_DAYS = 4;      // a bank can post a day or few BEFORE the owner tells us…
export const TOLD_MATCH_AFTER_DAYS = 10;      // …and usually some days AFTER

// The three keys this feature reads, read in the open (tests/importMetadataContract.test.js checks
// every read key has a checked writer): `told` and `receipt_to_come` are stamped after the post by
// persistJournalEntry's checked update; `receipt_waived` by waiveReceipt's checked update.
export const isToldPurchase = (e) => !!(e && e.import_metadata?.told);
const receiptPromised = (e) => !!(e && e.import_metadata?.receipt_to_come);
const receiptWaived = (e) => !!(e && e.import_metadata?.receipt_waived);
const systemKind = (e) => !!(e && e.import_metadata?.kind);
const isLive = (e) => !!e && !e.deleted_at && e.status !== "voided" && e.status !== "deleted";
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const ymd = (s) => String(s || "").slice(0, 10);
export function daysBetween(a, b) {
  const pa = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd(a)), pb = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd(b));
  if (!pa || !pb) return null;
  return Math.round((Date.UTC(+pb[1], +pb[2] - 1, +pb[3]) - Date.UTC(+pa[1], +pa[2] - 1, +pa[3])) / 86400000);
}
const vkey = (s) => String(s || "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "");
// Same supplier, loosely: "Home Depot" ~ "THE HOME DEPOT #4512" ~ "homedepot.com".
export function sameVendor(a, b) {
  const x = vkey(a), y = vkey(b);
  if (x.length < 3 || y.length < 3) return false;
  return x.includes(y) || y.includes(x);
}

// ── THE CARD AND THE ENTRY ─────────────────────────────────────────────────────

// What the assistant proposes, checked: a positive amount, a date, a supplier, and a SPENDING
// category that exists on this company's chart. Anything missing → { ok:false, reason } and the
// card says so (nothing is recorded on a guess).
export function checkToldPurchase(a = {}, { chart = [], today = "" } = {}) {
  const amount = r2(a.amount);
  if (!(amount > 0)) return { ok: false, reason: "I need the amount you paid — nothing would be recorded." };
  const vendor = String(a.vendor || "").trim();
  if (!vendor) return { ok: false, reason: "I need where you bought it — nothing would be recorded." };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(a.date || "")) ? a.date : today;
  if (!date) return { ok: false, reason: "I need the date you paid — nothing would be recorded." };
  const acct = (chart || []).find((x) => x && String(x.code) === String(a.gl_code));
  if (!acct) return { ok: false, reason: `There's no category numbered ${a.gl_code || "(none)"} on your chart — nothing would be recorded.` };
  if (!glIsExpense(String(acct.code))) return { ok: false, reason: `${acct.name} isn't a spending category — nothing would be recorded.` };
  return { ok: true, amount, vendor, date, acct, description: String(a.description || a.what || "").trim() };
}

// An entry already in the books that IS this purchase (the statement came first): same amount to
// the cent, a spending entry, the same supplier, dated within the window. Exactly one, or null —
// two candidates is a guess, and the purchase is then recorded as new (the bank line will be
// recognised against it when it arrives only if it is still unclaimed).
export function existingToldMatch(a = {}, entries = [], { today = "" } = {}) {
  const amount = r2(a.amount), date = /^\d{4}-\d{2}-\d{2}$/.test(String(a.date || "")) ? a.date : today;
  if (!(amount > 0) || !date) return null;
  const hits = perEntry(entries || []).filter((e) => {
    if (!isLive(e) || isReversalEntry(e) || e.reversed_by || settlementKind(e) || isToldPurchase(e)) return false;
    if (!glIsExpense(String(e.gl_code || ""))) return false;
    if (r2(e.amount) !== amount) return false;
    const gap = daysBetween(date, e.date);
    if (gap == null || gap < -TOLD_MATCH_AFTER_DAYS || gap > TOLD_MATCH_BEFORE_DAYS) return false;
    return sameVendor(a.vendor, e.vendor);
  });
  return hits.length === 1 ? hits[0] : null;
}

// The confirm card's sentence — read from what WILL be written (the account the code is, the
// account the money came from), never the model's own labels (§9: describe from the record).
export function toldPurchaseDescription(a = {}, { chart = [], payFrom, existing = null, today = "" } = {}) {
  if (existing) {
    return `${existing.vendor || "This purchase"} · ${fmtMoney(existing.amount)} on ${fmtDate(existing.date)} is already in your books (from your bank or card statement). Confirm to mark it as waiting for its receipt — it won't be recorded twice.`;
  }
  const c = checkToldPurchase(a, { chart, today });
  if (!c.ok) return c.reason;
  if (payFrom === null) return `I couldn't tell which account "${a.paid_from}" is — nothing would be recorded. Say your bank, your card, or your own money.`;
  const from = !payFrom ? "" : payFrom.key === OWN_MONEY ? " · paid with your own money (counted as money you put in)" : ` · paid from ${payFrom.label}`;
  const what = c.description ? ` (${c.description})` : "";
  return `Record ${fmtMoney(c.amount)} · ${c.vendor}${what} · ${c.acct.name} · ${fmtDate(c.date)}${from} · receipt to come.`;
}

// The entry, in the shape every booking path hands `bookToDb`. `id`/`bookedAt` are injected.
export function buildToldPurchase(a = {}, { chart = [], payFrom, today = "", id, bookedAt } = {}) {
  const c = checkToldPurchase(a, { chart, today });
  if (!c.ok || !payFrom) return null;
  return {
    id, vendor: c.vendor, description: c.description || c.vendor, amount: c.amount, date: c.date,
    gl_code: String(c.acct.code), gl_name: c.acct.name,
    secondary_gl_code: String(payFrom.code), secondary_gl_name: payFrom.name || payFrom.label,
    debit_credit: "debit", type: "expense", source: "manual", status: "booked",
    payment_status: "paid", payment_method_used: payFrom.key === OWN_MONEY ? "personal" : null,
    confidence: 100, approval_status: "approved", booked_at: bookedAt,
    reasoning: "Told to the assistant by the owner; receipt to come.",
    import_metadata: { told: "assistant", receipt_to_come: true },
  };
}

// The session's copy of an entry, after its checked write landed: every row of that entry gains the flag.
export function withEntryMetaFlag(rows = [], entryKey = "", flag = "") {
  return (rows || []).map((i) => (entryBaseOf(i) === String(entryKey) ? { ...i, import_metadata: { ...(i.import_metadata || {}), [flag]: true } } : i));
}

// ── THE LIST ON HOME ───────────────────────────────────────────────────────────

// Receipts worth adding: every purchase the owner told us about with nothing attached, and recent
// spending of $75+ with nothing attached. Not: system entries (payments, payroll, depreciation,
// starting balances — anything with a `kind`), corrected entries, or ones marked "I don't have one".
// Newest first. Each item: { entry, entryId, vendor, amount, date, told }.
export function receiptsToAdd({ invoices = [], docs = [], today = "", threshold = RECEIPT_THRESHOLD, recentDays = RECENT_DAYS } = {}) {
  const linked = linkedDocIds(docs);
  const out = [];
  for (const e of perEntry(invoices || [])) {
    if (!isLive(e) || isReversalEntry(e) || e.reversed_by) continue;
    if (systemKind(e) || settlementKind(e) || e.source === "opening_balance" || e.source === "payroll") continue;
    if (receiptWaived(e)) continue;
    if (!glIsExpense(String(e.gl_code || ""))) continue;
    if (hasSourceDoc(e, linked)) continue;
    const told = isToldPurchase(e) || receiptPromised(e);
    if (!told) {
      if (r2(e.amount) < threshold) continue;
      const age = today ? daysBetween(e.date, today) : null;
      if (age == null || age < 0 || age > recentDays) continue;
    }
    out.push({ entry: e, entryId: entryBaseOf(e), vendor: e.vendor || "A purchase", amount: r2(e.amount), date: ymd(e.date), told });
  }
  return out.sort((a, b) => (b.told - a.told) || b.date.localeCompare(a.date));
}

export const RECEIPTS_COPY = {
  title: (n) => `${n} receipt${n === 1 ? "" : "s"} to add`,
  sub: "Snap a photo of each and it's filed with the purchase. Needed for anything $75 or more; below that your bank record is usually enough.",
  told: "you said the receipt is coming",
  more: (n) => `Show ${n} more`,
  less: "Show fewer",
  saved: (v) => `Receipt saved with ${v} ✓`,
  waived: (v) => `Okay — ${v} won't be asked about again.`,
};
