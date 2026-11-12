// ═════════════════════════════════════════════════════════════════════════════
// C630 — THE STATEMENT DECIDES WHAT HAPPENED; THE AI ONLY SAYS WHAT IT WAS FOR.
// Review finding K5. The categoriser's reply REPLACED the parsed lines outright, so its
// amounts, dates, descriptions and line count were all taken as fact: a dropped line was
// never booked, a rounded or mistyped amount was booked as typed, and its `type` decided the
// direction — so a vendor REFUND (money in, filed under an expense) was booked as money out.
//
// Here each PARSED line is the record. From the categoriser we take only the classification
// (category, vendor name, type, confidence, reason). We find each line's suggestion by
// position when the counts agree and the amounts match, otherwise by amount and date; a line
// with no trustworthy suggestion — or whose suggestion disagrees on the amount — is flagged
// for review at low confidence rather than guessed. `money_in` carries the direction the
// money actually moved, read from the statement.
// ═════════════════════════════════════════════════════════════════════════════
import { signedStatementAmount } from "./openingBalanceProposal.js";

const abs2 = (n) => Math.round(Math.abs(Number(n) || 0) * 100) / 100;
const sameAmount = (a, b) => Math.abs(abs2(a) - abs2(b)) < 0.01;

export function mergeCategorized(rawTxns = [], categorized = []) {
  const raw = rawTxns || [];
  const cats = Array.isArray(categorized) ? categorized : [];
  const used = new Set();
  const byPosition = cats.length === raw.length;
  const pick = (r, i) => {
    if (byPosition && cats[i] && sameAmount(cats[i].amount, r.amount)) { used.add(i); return cats[i]; }
    let j = cats.findIndex((c, k) => !used.has(k) && c && sameAmount(c.amount, r.amount) && String(c.date || "") === String(r.date || ""));
    if (j < 0) j = cats.findIndex((c, k) => !used.has(k) && c && sameAmount(c.amount, r.amount));
    if (j < 0) return null;
    used.add(j); return cats[j];
  };
  return raw.map((r, i) => {
    const signed = signedStatementAmount(r);
    const amount = signed != null ? signed : Number(r.amount) || 0;
    const facts = { date: r.date, description: r.description ?? null, amount, balance: r.balance ?? null, money_in: amount > 0 };
    const c = pick(r, i);
    if (!c) {
      return { ...facts, vendor: r.description || "Unknown", type: amount > 0 ? "revenue" : "expense", gl_code: null, gl_name: null,
        confidence: 0, needs_review: true, reasoning: "We couldn't match this line to a suggested category — please choose one." };
    }
    return { ...c, ...facts, type: c.type || (amount > 0 ? "revenue" : "expense") };
  });
}
