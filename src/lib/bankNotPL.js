// ═════════════════════════════════════════════════════════════════════════════
// ★★ C651 — A BANK LINE WHOSE OWN WORDS SAY IT IS NOT INCOME OR SPENDING IS NOT AUTO-BOOKED AS
// EITHER.
//
// The bank categoriser (`categorize-bank`, ai-proxy) is instructed that every line is "expense"
// or "revenue" and that balance-sheet accounts are NEVER a line's category. So a line reading
// "ONLINE TRANSFER TO SAVINGS", "CHASE CREDIT CRD AUTOPAY", "OWNER DRAW" or "SBA LOAN PMT" could
// only be filed as spending (money out) or a sale (money in) — and at the model's usual
// confidence it booked with nobody asked. Each of those moves money between the owner's own
// accounts, pays down a debt, or pays the owner: none is profit or loss, and each one booked as
// spending or income moves profit and the tax estimate by its full amount.
//
// The prompt is the real fix and needs an ai-proxy deploy (operator's call). This is the guard
// that does not: the line's OWN TEXT is read, and a match is held for a person (needs_review),
// never booked. It routes as any uncertain line does — to the reviewer, or to the solo owner's
// question cards (C641), where C649/C650 make sure "a transfer" is not then booked as a sale.
//
// Deliberately narrow. Zelle / Venmo / PayPal / Cash App / Square / Stripe / wire lines are how
// CUSTOMERS pay and suppliers are paid, so the word "transfer" beside them is not enough.
// A vendor rule the owner made is respected (the caller skips `rule_applied` lines).
// ═════════════════════════════════════════════════════════════════════════════

const PAYMENT_APPS = /\b(zelle|venmo|paypal|cash ?app|square|sq \*|stripe|wire)\b/i;

// ★ C659 (review) — narrowed. A card brand beside the bare word "payment" is a restaurant, an
// arena, a café ("Payment to Discover Grill catering", "Capital One Arena payment tickets",
// "Payment received - Discover Cafe invoice 22"); "SBA filing fee", "line of credit interest",
// "Mortgage Solutions LLC", "Bank transfer fee" and "ONLINE TRANSFER FROM ACME INC" (a customer)
// were all held. Each kind now needs words that only the thing itself uses.
const BRANDS = String.raw`(amex|american express|discover|capital one|citi ?cards?|chase (card|credit)|credit cr?d|card services|barclaycard|synchrony)`;
const CARD_PAY = String.raw`(e-?pay(ment)?|autopay|auto pay|(online|ach|mobile|web) (pmt|pymt|payment)|pmt|pymt)`;
const KINDS = [
  ["card", new RegExp(String.raw`\b${BRANDS}\b[\s\S]*\b${CARD_PAY}\b|\b${CARD_PAY}\b[\s\S]*\b${BRANDS}\b|\bcredit card (pmt|pymt|payment|bill)\b|\b(pmt|pymt|payment) (to|for) (a |the |my |our )?credit card\b`, "i")],
  ["owner", /\bowners? draw\b|\bowner'?s draw\b|\bmember (draw|distribution)\b|\bshareholder distribution\b|\bowner (contribution|investment)\b/i],
  ["loan", /\bloan (pmt|pymt|payment|proceeds|advance|disbursement)\b|\bsba (loan|pmt|pymt|payment|eidl)\b|\beidl\b|\b(mortgage|mtg) (pmt|pymt|payment)\b|\bhome mtg\b|\bline of credit (pmt|pymt|payment|advance|draw)\b|\bloc (pmt|payment|advance)\b/i],
  ["transfer", /\binternal (transfer|xfer|trnsfr)\b|\bbook transfer\b|\b(transfer|xfer|trnsfr) (to|from) (savings|checking|sav|chk|acct|account|x+\d+|\d{4})\b|\b(to|from) (savings|checking) (acct|account)\b/i],
];
const FEE = /\bfees?\b/i;

// ★ C653 — ON A CREDIT CARD'S OWN STATEMENT, the monthly payment arrives as money IN with no
// card brand in it ("PAYMENT - THANK YOU", "AUTOPAY PAYMENT"), so the pattern above never saw it
// and it was filed as a SALE. On a card account, money in that says payment / autopay / thank you
// is the payoff. (A refund on a card — "AMAZON RETURN" — is not held: it is money back on a
// purchase, and books as one.)
const CARD_PAYMENT_IN = /\b(payment|pymt|pmt|autopay|auto pay|e-?payment|thank you)\b/i;
export function isCardAccount(account) {
  if (!account) return false;
  return account.type === "credit_card" || /^2\d{3}$/.test(String(account.gl_code || ""));
}

export function notProfitAndLossKind(line = {}, { cardAccount = false } = {}) {
  const text = `${line.description || ""} ${line.vendor || ""}`;
  if (cardAccount && line.money_in === true && CARD_PAYMENT_IN.test(text)) return "card";
  for (const [kind, re] of KINDS) {
    if (!re.test(text)) continue;
    if (kind === "transfer" && (PAYMENT_APPS.test(text) || FEE.test(text))) return null;
    // C659 — a card is paid FROM a bank account: money coming INTO one is never a card payoff
    // (it would have built Dr checking / Cr card — a customer's payment turned into card debt).
    if (kind === "card" && line.money_in === true && !cardAccount) return null;
    return kind;
  }
  return null;
}

// The reviewer's (and the owner's) one-line reason, in plain words.
export const NOT_PL_REASON = {
  card: "This looks like a payment to a credit card. Paying off a card isn't new spending (the purchases on it are), so it wasn't recorded automatically.",
  owner: "This looks like money paid to or from the owner. That isn't business income or spending, so it wasn't recorded automatically.",
  loan: "This looks like a loan payment or loan money. Only a loan's interest is spending, so it wasn't recorded automatically.",
  transfer: "This looks like money moved between your own accounts. That isn't income or spending, so it wasn't recorded automatically.",
};

// Applied to the categoriser's output, after vendor rules. A rule the owner made wins.
export function holdNotProfitAndLoss(lines = [], { account = null } = {}) {
  const cardAccount = isCardAccount(account);
  return (lines || []).map((t) => {
    if (!t || t.rule_applied) return t;
    const kind = notProfitAndLossKind(t, { cardAccount });
    if (!kind) return t;
    return { ...t, needs_review: true, confidence: Math.min(Number(t.confidence) || 0, 50), not_pl: kind, reasoning: NOT_PL_REASON[kind] };
  });
}
