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

// ★★ C649 — MONEY IN IS NOT ALWAYS INCOME, AND THE ANSWER SAYS SO. An income card's answer was
// read ONLY against income categories, and `incomeAccountForAnswer` always returns one (its last
// fallback is the chart's first income account). So on a bank line that came IN, "a refund from
// Home Depot", "money from my savings" or "a loan from my brother" were booked as SALES —
// income on the P&L, income on the tax estimate. These words are read first:
//   refund   → booked against the spending category it names (a credit to it) — bank lines only,
//              where the statement fixes the direction; with no category, the card asks.
//   owner / loan / transfer → NOT booked. Where each goes (owner's equity, which loan, which of
//              your accounts) is a decision the app should not guess; the card says it won't be
//              counted as income and the line stays on the list.
// Order matters: "a transfer from my personal account" is the owner's own money.
const NOT_INCOME = [
  ["refund", /\brefund(s|ed)?\b|\breturn(s|ed)?\b|\bmoney back\b|\bcredit(ed)? back\b|\breimburs\w*/i],
  ["owner", /\bmy own (money|cash|funds)\b|\b(i|we) put (in )?(some |my |our )?(own )?(money|cash|funds)\b|\bput (money|cash|funds) in\b|\bpersonal (money|funds|account|savings|card)\b|\bowner'?s? (investment|contribution|money|capital)\b|\bcapital (contribution|injection)\b|\binvest(ed|ment)? (in|into) the business\b|\bfrom my personal\b/i],   // C659 — "from my savings" is a transfer, below
  ["loan", /\bloan(ed|s)?\b|\bborrow(ed|ing)?\b|\bline of credit\b|\bsba\b/i],
  ["transfer", /\btransfer(red|s)?\b|\bmoved? (the )?(money|cash|it)\b|\bfrom (my|our) (other|savings|checking) account\b|\bfrom (my|our) (savings|checking)\b|\bbetween (my|our) accounts\b/i],
];
// "The customer paid by wire transfer" is a sale: a customer, a job or an invoice in the answer
// means the transfer word is only how it was paid.
const SALE_WORDS = /\b(customers?|clients?|sales?|sold|invoices?|jobs?|orders?|paid (me|us))\b/i;
export function notIncomeAnswer(text) {
  const t = String(text || "");
  for (const [kind, re] of NOT_INCOME) {
    if (!re.test(t)) continue;
    if (kind === "transfer" && SALE_WORDS.test(t)) return null;
    return kind;
  }
  return null;
}
export const NOT_INCOME_COPY = {
  refund: "A refund for what? Say what it was for — like “a refund for supplies” — and I'll take it off that spending.",
  refund_doc: "A refund isn't a sale, so I won't record it as income. Skip this one for now — it won't be counted as income.",
  owner: "Money you put in yourself isn't income, so I won't record it as a sale. Skip this one for now — it stays on your list and won't be counted as income.",
  loan: "A loan isn't income, so I won't record it as a sale. Skip this one for now — it stays on your list and won't be counted as income.",
  transfer: "Money moved between your own accounts isn't income, so I won't record it as a sale. Skip this one for now — it stays on your list and won't be counted as income.",
};

// ★★ C650 — AND MONEY OUT IS NOT ALWAYS SPENDING. The mirror of C649: on a card for money going
// OUT, an answer the keyword map couldn't place went to the AI, which may only choose from the
// spending and income categories — and may CREATE a spending category. So "I paid myself",
// "loan payment", "paid off the credit card" or "moved it to savings" were booked as business
// EXPENSES: profit and tax understated. Read only after the category map has had its turn, so an
// answer that names a real category ("wire transfer to the supplier for flour") still books.
const NOT_EXPENSE = [
  ["owner", /\b(paid|pay|paying) myself\b|\bowner'?s? (draw|distribution)s?\b|\bdistributions? to (me|myself|the owner)\b|\bpersonal (purchase|expense|use|stuff|item|items|spending)\b|\bfor me personally\b|\bnot (for )?(the |a )?business\b|\bmy own (use|stuff)\b/i],
  ["card", /\b(paid|pay|paying) (off )?(the |my |our )?(credit )?card\b|\bcredit card (bill|payment)\b|\bcard payment\b/i],
  ["loan", /\bloan (payment|repayment)s?\b|\b(paid|pay|paying) (back )?(the |a |my |our )?loan\b|\bsba\b|\bmortgage\b/i],
  ["transfer", /\btransfer(red|s)?\b|\bmoved? (the )?(money|cash|it)\b|\bto (my|our) (other|savings|checking) account\b|\bbetween (my|our) accounts\b/i],
];
export function notExpenseAnswer(text) {
  const t = String(text || "");
  for (const [kind, re] of NOT_EXPENSE) if (re.test(t)) return kind;
  return null;
}
export const NOT_EXPENSE_COPY = {
  owner: "Paying yourself isn't a business expense, so I won't record it as one. Skip this one for now — it stays on your list and won't be counted as spending.",
  card: "Paying off a credit card isn't new spending — the purchases on the card are. I won't record it as an expense. Skip this one for now — it stays on your list.",
  loan: "Paying back a loan isn't a business expense (only the interest is), so I won't record it as one. Skip this one for now — it stays on your list.",
  transfer: "Money moved between your own accounts isn't spending, so I won't record it as an expense. Skip this one for now — it stays on your list.",
};

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
