// ═════════════════════════════════════════════════════════════════════════════
// C641 — AN OWNER WITH NO ACCOUNTANT ANSWERS THEIR OWN BANK LINES.
// A statement line the app couldn't categorise is held for a reviewer ("excepted",
// `low_confidence`). With an accountant, that is their queue. Without one, Home said "invite
// your accountant to finish them" — a dead end for the owner who has none. Those lines now
// become the same plain question cards an uploaded bill gets ("What was the $84.12 payment to
// Home Depot on March 2 for?"); the answer files the line against the bank account it came from.
//
// ONLY `low_confidence`: a line the app could not CATEGORISE. A line it could not MATCH to a bill
// stays with an accountant — booking it fresh could count a bill that is already recorded twice.
// Pure: built from the loaded exceptions, the statements and the bank accounts.
// ═════════════════════════════════════════════════════════════════════════════
import { draftClientQuestion } from "./clarify.js";
import { fmtMoney } from "./format.js";
import { notProfitAndLossKind } from "./bankNotPL.js";

export const OWNER_ANSWERABLE_REASONS = new Set(["low_confidence"]);

export function ownerAnswerableLines(exceptions = []) {
  return (exceptions || []).filter((e) => e && e.kind === "line" && OWNER_ANSWERABLE_REASONS.has(e.reason));
}

// C649 — money that came INTO the bank isn't necessarily a sale: a store refund, the owner's
// own money, a loan. The document question (C-era clarify.js) offers "a one-time project,
// ongoing/retainer work" — a service business's sales — which reads oddly beside "Home Depot".
export function moneyInQuestion(inv = {}) {
  const amt = fmtMoney(Math.abs(Number(inv.amount) || 0));
  const who = inv.vendor && inv.vendor !== "Bank transaction" ? ` from ${inv.vendor}` : "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(inv.date || ""));
  const when = m ? ` on ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(m[2]) - 1]} ${Number(m[3])}` : "";
  return `What was the ${amt} that came in${who}${when}? (A sale? A refund — and for what? Something else?)`;
}

// C652 — a line C651 held (its own words read as a transfer, a card payoff, an owner draw or a
// loan) is asked as what it LOOKS like, so the owner isn't asked "what was this for?" about a
// card payment as if it were a purchase. If it was something else, they say so and it books.
const HELD_LOOKS_LIKE = {
  card: "looks like paying off a credit card, which isn't new spending",
  owner: "looks like money paid to or from the owner, which isn't business income or spending",
  loan: "looks like a loan payment or loan money, which isn't income or spending (only a loan's interest is)",
  transfer: "looks like money moved between your own accounts, which isn't income or spending",
};
export function heldQuestion(inv = {}) {
  const kind = notProfitAndLossKind(inv);
  if (!kind) return null;
  const amt = fmtMoney(Math.abs(Number(inv.amount) || 0));
  const who = inv.vendor && inv.vendor !== "Bank transaction" ? ` ${inv.money_in ? "from" : "to"} ${inv.vendor}` : "";
  return `The ${amt}${who} ${HELD_LOOKS_LIKE[kind]}, so it hasn't been recorded. If it was something else, say what it was for.`;
}

export function bankLineQuestionCards(exceptions = [], { statements = [], bankAccounts = [], cashCode = null, cashName = null } = {}) {
  return ownerAnswerableLines(exceptions).map((e) => {
    const stmt = (statements || []).find((s) => String(s.id) === String(e.statement_id)) || null;
    const acctId = e.bank_account_id != null ? e.bank_account_id : stmt ? stmt.bank_account_id : null;   // the loader attaches it (C641)
    const acct = acctId != null ? (bankAccounts || []).find((b) => String(b.id) === String(acctId)) : null;
    const offset = (acct && acct.gl_code) || cashCode;
    const amount = Number(e.amount) || 0;
    const moneyIn = amount > 0;
    const lineId = String(e.id).replace(/^sxl_/, "");
    const invoice = {
      id: `sxq_${lineId}`, vendor: e.vendor || e.description || "Bank transaction", description: e.description || "",
      amount: Math.abs(amount), date: e.date, type: moneyIn ? "revenue" : "expense", money_in: moneyIn,
      gl_code: null, gl_name: null, secondary_gl_code: offset, secondary_gl_name: (acct && acct.name) || cashName,
      debit_credit: moneyIn ? "credit" : "debit", confidence: 0, status: "booked", source: "bank_statement",
      payment_status: "paid",
    };
    return {
      id: `sxq_${lineId}`, invoice, queueItemId: null,
      question: heldQuestion(invoice) || (moneyIn ? moneyInQuestion(invoice) : draftClientQuestion(invoice).question),
      statementLine: { lineId, statementId: e.statement_id, accountId: acct ? acct.id : null, accountCode: offset },
      suggestedCode: null, suggestedName: null,
    };
  });
}

export function bankLinesWaitingCopy(n) {
  return n === 1
    ? "One thing from your bank statement needs your answer before it's added — what was it for?"
    : `${n} things from your bank statement need your answer before they're added — what were they for?`;
}
