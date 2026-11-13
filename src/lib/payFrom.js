// ═════════════════════════════════════════════════════════════════════════════
// ★ C674 — "PAID FROM": WHERE THE MONEY FOR A BILL CAME FROM.
//
// Marking a bill paid always took the money from the main bank (Cash), whatever paid it. A bill
// paid with the business card belongs on the card (it is now owed there — Dr Bills you owe /
// Cr the card); one paid from savings belongs on savings; and one the owner paid personally —
// the everyday case for a solo creator — is money the OWNER put in (Dr Bills you owe / Cr owner
// contributions, by the C655 rule: a corporation's Paid-In Capital, otherwise Owner
// Contributions). Pure, so the forms, Home and the assistant offer the same list.
// ═════════════════════════════════════════════════════════════════════════════
import { ownerEquityAccount } from "./balanceSheetMoves.js";

export const OWN_MONEY = "own";

export function payFromOptions({ bankAccounts = [], getAccountByRole = () => null, chart = [], legalForm = "" } = {}) {
  const out = [];
  const seen = new Set();
  for (const b of bankAccounts || []) {
    if (!b || !b.gl_code || seen.has(String(b.gl_code))) continue;
    seen.add(String(b.gl_code));
    const card = b.type === "credit_card";
    out.push({ key: `acct:${b.id}`, label: card ? `${b.name || "Credit card"} (card)` : (b.name || "Bank account"), code: String(b.gl_code), name: b.name || null, create: false });
  }
  if (!out.length) {
    const cash = getAccountByRole("cash");
    if (cash) out.push({ key: "cash", label: "Your bank account", code: String(cash.code), name: cash.name, create: false });
  }
  const own = ownerEquityAccount({ legalForm, chart, getAccountByRole });
  if (own) out.push({ key: OWN_MONEY, label: "My own money (personal card or cash)", code: own.code, name: own.name, create: !!own.create });
  return out;
}

export function payFromByKey(options = [], key = null) {
  return (options || []).find((o) => o.key === key) || (options || [])[0] || null;
}

// C676 — the account the owner NAMED in words ("my own money", "the Amex", "savings"), for the
// assistant. Own money by its words; otherwise the option whose label contains what was said;
// otherwise the main bank (the first) — never a guess at a different account.
export function pickPayFrom(options = [], said = "") {
  const t = String(said || "").trim().toLowerCase();
  if (!t) return (options || [])[0] || null;
  if (/^(own|my own|personal|myself|out of pocket|cash)/.test(t)) return (options || []).find((o) => o.key === OWN_MONEY) || (options || [])[0] || null;
  return (options || []).find((o) => o.label.toLowerCase().includes(t) || (o.name || "").toLowerCase().includes(t)) || (options || [])[0] || null;
}

// What the owner is told — from the option chosen.
export function paidFromCopy(option) {
  if (!option) return "";
  return option.key === OWN_MONEY ? "paid with your own money — counted as money you put into the business" : `paid from ${option.label}`;
}

// ═════════════════════════════════════════════════════════════════════════════
// ★ C677 — "RECEIVED INTO": WHERE A CUSTOMER'S PAYMENT WENT.
// A creator's brand deal often lands in a PERSONAL PayPal or bank account. Recording it as
// received into the business bank would show cash the business never had; the sale was already
// counted when the invoice was sent, so the right entry is Dr Owner's Draw / Cr Money owed to
// you — income the business earned, which went straight to the owner. Bank accounts only (a
// card is not where a customer's money lands), then the owner's personal account.
// ═════════════════════════════════════════════════════════════════════════════
export const PERSONAL = "personal";
export function receivedIntoOptions({ bankAccounts = [], getAccountByRole = () => null } = {}) {
  const out = [];
  const seen = new Set();
  for (const b of bankAccounts || []) {
    if (!b || !b.gl_code || b.type === "credit_card" || /^2\d{3}$/.test(String(b.gl_code)) || seen.has(String(b.gl_code))) continue;
    seen.add(String(b.gl_code));
    out.push({ key: `acct:${b.id}`, label: b.name || "Bank account", code: String(b.gl_code), name: b.name || null });
  }
  if (!out.length) {
    const cash = getAccountByRole("cash");
    if (cash) out.push({ key: "cash", label: "Your bank account", code: String(cash.code), name: cash.name });
  }
  const draw = getAccountByRole("owners_draw");
  if (draw) out.push({ key: PERSONAL, label: "My personal account (counted as money you took out)", code: String(draw.code), name: draw.name });
  return out;
}
export function receivedIntoCopy(option) {
  if (!option) return "";
  return option.key === PERSONAL ? "received into your personal account — counted as money you took out" : `received into ${option.label}`;
}
