// ═════════════════════════════════════════════════════════════════════════════
// C776 — "I GOT PAID $500": MONEY RECEIVED, TOLD TO THE ASSISTANT.
//
// The owner says "AllDay Pizza paid me $500 by Zelle for a sponsored post". There was no action for
// it, so the model reached for `record_purchase` and the card said "I need the amount you paid —
// nothing was recorded" — after a conversation that ended "Confirm below and it's in the books".
// This is the income twin of C755's told purchase, with the same three protections:
//   (1) NEVER COUNTED TWICE. If the books already hold it (a deposit from the statement, or an
//       invoice already sent to that customer), the card says so: a matching deposit means nothing is
//       recorded; an open invoice for that customer and amount is recorded as COLLECTED (the sale was
//       counted when the invoice went out — booking it as new income would count it twice).
//   (2) WHERE THE MONEY WENT decides the entry (C677's rule): into a business account → that
//       account; into the owner's personal account → income the business earned that went straight
//       to the owner (Dr Owner's Draw / Cr income). The owner's words pick it; words that pin down
//       no account → nothing is recorded and the assistant asks.
//   (3) A STATEMENT ARRIVING LATER recognises it: it is stamped `told` like a told purchase, and
//       markAlreadyBooked's second pass matches money-in lines too (openingBalanceProposal.js).
// Pure — the confirm card and the executor both read these.
// ═════════════════════════════════════════════════════════════════════════════
import { glIsRevenue, isReversalEntry } from "./gl.js";
import { settlementKind, perEntry } from "./txnPresent.js";
import { fmtMoney, fmtDate } from "./format.js";
import { PERSONAL, pickPayFrom } from "./payFrom.js";
import { sameVendor, daysBetween, isToldPurchase, TOLD_MATCH_BEFORE_DAYS, TOLD_MATCH_AFTER_DAYS } from "./toldPurchase.js";

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const isLive = (e) => !!e && !e.deleted_at && e.status !== "voided" && e.status !== "deleted";
const customerOf = (a = {}) => String(a.customer || a.vendor || "").trim();
const dateOf = (a = {}, today = "") => (/^\d{4}-\d{2}-\d{2}$/.test(String(a.date || "")) ? a.date : today);

// The income account: the code the model chose if it is on the chart, else the company's default
// income account when no code was given at all. A code that is not on the chart, or not income, is
// refused — nothing is recorded on a guess.
export function checkToldIncome(a = {}, { chart = [], today = "", defaultIncomeCode = null } = {}) {
  const amount = r2(a.amount);
  if (!(amount > 0)) return { ok: false, reason: "I need the amount you received — nothing would be recorded." };
  const customer = customerOf(a);
  if (!customer) return { ok: false, reason: "I need who paid you — nothing would be recorded." };
  const date = dateOf(a, today);
  if (!date) return { ok: false, reason: "I need the date you were paid — nothing would be recorded." };
  const code = a.gl_code != null && String(a.gl_code).trim() ? String(a.gl_code) : defaultIncomeCode;
  const acct = (chart || []).find((x) => x && String(x.code) === String(code));
  if (!acct) return { ok: false, reason: `There's no category numbered ${code || "(none)"} on your chart — nothing would be recorded.` };
  if (!glIsRevenue(String(acct.code))) return { ok: false, reason: `${acct.name} isn't an income category — nothing would be recorded.` };
  return { ok: true, amount, customer, date, acct, description: String(a.description || a.what || "").trim() };
}

// The account the owner named for where the money landed. "personal", "my own account", "me" →
// the owner's personal account; a business account by its words (C687's matching); nothing said →
// the main business account. null → the words pin down nothing; the assistant asks.
export function pickReceivedInto(options = [], said = "") {
  const opts = options || [];
  const t = String(said || "").trim().toLowerCase();
  if (!t) return opts.find((o) => o.key !== PERSONAL) || null;
  if (/\b(personal|my own|own account|myself|to me|my account)\b/.test(t)) return opts.find((o) => o.key === PERSONAL) || null;
  return pickPayFrom(opts.filter((o) => o.key !== PERSONAL), t);
}

// A deposit already in the books that IS this money (the statement came first): income, the same
// amount to the cent, the same customer, dated within the window. Exactly one, or null.
export function existingIncomeMatch(a = {}, entries = [], { today = "" } = {}) {
  const amount = r2(a.amount), date = dateOf(a, today), customer = customerOf(a);
  if (!(amount > 0) || !date || !customer) return null;
  const hits = perEntry(entries || []).filter((e) => {
    if (!isLive(e) || isReversalEntry(e) || e.reversed_by || settlementKind(e) || isToldPurchase(e)) return false;
    if (!glIsRevenue(String(e.gl_code || "")) || e.debit_credit === "debit") return false;
    if (r2(e.amount) !== amount) return false;
    const gap = daysBetween(date, e.date);
    if (gap == null || gap < -TOLD_MATCH_AFTER_DAYS || gap > TOLD_MATCH_BEFORE_DAYS) return false;
    return sameVendor(customer, e.vendor);
  });
  return hits.length === 1 ? hits[0] : null;
}

// An invoice already sent to this customer for exactly this amount (or exactly what is still owed on
// it). `openItems` is matchableOpenItems' list; only A/R items count. Exactly one, or null.
export function openInvoiceMatch(a = {}, openItems = [], { arCode = null } = {}) {
  const amount = r2(a.amount), customer = customerOf(a);
  if (!(amount > 0) || !customer || arCode == null) return null;
  const onAr = (i) => String(i.gl_code) === String(arCode) || String(i.secondary_gl_code) === String(arCode);
  const owed = (i) => r2(i.balance_remaining != null ? i.balance_remaining : i.ar_amount != null ? i.ar_amount : i._entryTotal != null ? i._entryTotal : i.amount);
  const hits = (openItems || []).filter((i) => i && onAr(i) && owed(i) === amount && sameVendor(customer, i.vendor));
  return hits.length === 1 ? hits[0] : null;
}

const intoPhrase = (into) => (!into ? "" : into.key === PERSONAL ? " · into your personal account (counted as money you took out)" : ` · into ${into.label}`);

// The confirm card's sentence — read from what WILL be written (§9: describe from the record).
export function toldIncomeDescription(a = {}, { chart = [], receivedInto, existing = null, openInvoice = null, today = "", defaultIncomeCode = null } = {}) {
  if (existing) return `${existing.vendor || "This payment"} · ${fmtMoney(existing.amount)} on ${fmtDate(existing.date)} is already in your books (from your bank statement) — nothing would be recorded twice.`;
  if (receivedInto === null) return `I couldn't tell which account "${a.received_into}" is — nothing would be recorded. Say your business account's name, or "my personal account".`;
  if (openInvoice) return `${openInvoice.vendor || "This customer"} already has an invoice for ${fmtMoney(a.amount)} — record it as paid${intoPhrase(receivedInto)}. It isn't counted as new income twice.`;
  const c = checkToldIncome(a, { chart, today, defaultIncomeCode });
  if (!c.ok) return c.reason;
  const what = c.description ? ` (${c.description})` : "";
  return `Record ${fmtMoney(c.amount)} received from ${c.customer}${what} · ${c.acct.name} · ${fmtDate(c.date)}${intoPhrase(receivedInto)}.`;
}

// The entry, in the shape every booking path hands `bookToDb`: Dr where it landed / Cr income.
export function buildToldIncome(a = {}, { chart = [], receivedInto, today = "", defaultIncomeCode = null, id, bookedAt } = {}) {
  const c = checkToldIncome(a, { chart, today, defaultIncomeCode });
  if (!c.ok || !receivedInto) return null;
  return {
    id, vendor: c.customer, description: c.description || `Payment from ${c.customer}`, amount: c.amount, date: c.date,
    gl_code: String(c.acct.code), gl_name: c.acct.name,
    secondary_gl_code: String(receivedInto.code), secondary_gl_name: receivedInto.name || receivedInto.label,
    debit_credit: "credit", type: "revenue", source: "manual", status: "booked",
    payment_status: "paid", payment_method_used: receivedInto.key === PERSONAL ? "personal" : null,
    confidence: 100, approval_status: "approved", booked_at: bookedAt,
    reasoning: "Told to the assistant by the owner.",
    import_metadata: { told: "assistant" },
  };
}

