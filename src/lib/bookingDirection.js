// ═════════════════════════════════════════════════════════════════════════════
// C591 — THE CATEGORY DECIDES THE DIRECTION, EVERY TIME.
//
// An uploaded document's direction lived in four fields that were set in different places
// and could disagree: `gl_code` (what it is), `debit_credit` (which side), `secondary_gl_*`
// (who owes whom) and `type`. Three ways they came apart, from the whole-code review:
//
//  • "We sent it — a customer owes us" changed the category to income and the offset to
//    money-owed-to-you, and left `debit_credit` where the AI's first guess put it. When that
//    guess was "a bill", the entry posted Dr Income / Cr Receivable — income BACKWARDS, and a
//    customer shown as owed money.
//  • A vendor rule on a document the AI called income set the category from the rule and the
//    side from the AI: Cr <expense> / Dr Bills-to-pay.
//  • After "This is revenue", the typed answer went through the EXPENSE vocabulary
//    ("consulting" → Professional Services) and was booked as income on an expense category.
//
// One pure rule, applied where an uploaded document is built and where an answer is booked:
// an income category is a credit against money owed to you; an expense category is a debit
// against bills to pay. An offset that is neither A/R nor A/P (cash, a card) is left alone —
// "already paid" is a fact about settlement, not direction. Anything on a balance-sheet
// category is returned untouched.
// ═════════════════════════════════════════════════════════════════════════════
import { glIsRevenue, glIsExpense } from "./gl.js";

export function alignDirectionToAccount(inv, { ar = {}, ap = {} } = {}) {
  if (!inv) return inv;
  const code = String(inv.gl_code ?? "");
  const rev = glIsRevenue(code);
  if (!rev && !glIsExpense(code)) return inv;
  const mine = rev ? ar : ap;      // the offset this direction settles against
  const other = rev ? ap : ar;     // the offset that belongs to the opposite direction
  const sec = inv.secondary_gl_code == null ? "" : String(inv.secondary_gl_code);
  const swap = !sec || (other.code != null && sec === String(other.code));
  // ★ C641 — A LINE FROM A BANK STATEMENT CARRIES THE DIRECTION THE MONEY MOVED (`money_in`, C630).
  // When the other side is that bank account (not money owed either way), the statement decides
  // the side: a supplier's refund is money IN filed under an expense — a credit to the expense,
  // not a second purchase.
  const settledThroughBank = typeof inv.money_in === "boolean" && !swap && sec !== String(mine.code ?? "");
  const out = {
    ...inv,
    type: rev ? "revenue" : "expense",
    debit_credit: settledThroughBank ? (inv.money_in ? "credit" : "debit") : rev ? "credit" : "debit",
    ...(swap && mine.code != null ? { secondary_gl_code: mine.code, secondary_gl_name: mine.name } : {}),
  };
  if (inv._contact) out._contact = { ...inv._contact, type: rev ? "customer" : "vendor" };
  return out;
}

// What a plain answer says about INCOME. The expense vocabulary (`answerToAccount`) has no
// income words at all, so an income document's answer is read here, against the company's own
// income categories by role, and falls back to the category the card was already suggesting.
// Never an expense category, never a new one.
const INCOME_WORDS = [
  ["subscription_revenue", /\b(subscription|membership|recurring plan|monthly plan|annual plan)\b/i],
  ["interest_income", /\binterest\b/i],
  ["product_revenue", /\b(product|goods|merch|merchandise|item|items|sold|order|stock|inventory)\b/i],
  ["service_revenue", /\b(service|services|project|retainer|consult\w*|work|job|labou?r|install\w*|repair\w*|design\w*|hours|session|class|lesson|coaching|fee)\b/i],
];

export function incomeAccountForAnswer(text, { getAccountByRole = () => null, chart = [], fallback = null } = {}) {
  const onChart = (a) => a && a.code != null && (chart || []).some((c) => String(c.code) === String(a.code) && glIsRevenue(String(c.code)));
  for (const [role, re] of INCOME_WORDS) {
    if (!re.test(String(text || ""))) continue;
    const a = getAccountByRole(role);
    if (onChart(a)) return { gl_code: String(a.code), gl_name: a.name };
  }
  if (fallback && glIsRevenue(String(fallback.gl_code ?? ""))) return { gl_code: String(fallback.gl_code), gl_name: fallback.gl_name };
  const first = (chart || []).find((c) => glIsRevenue(String(c.code)));
  return first ? { gl_code: String(first.code), gl_name: first.name } : null;
}
