// ─────────────────────────────────────────────────────────────────────────────
// Bank-account "source" helpers. A bank_accounts row is a money SOURCE the user
// registered (checking / savings / credit card / loan). Each source has a natural
// OFFSET GL account: a card's charges offset to Credit Card Liability (2200), a
// bank's to Cash (1000), a loan's to Long-Term Debt (2500). This is the single
// source for the type→GL "data nudge" used by BOTH the Settings bank-account editor
// and the inline "+ Add account" in the import picker (O57/C63 + O63), so they can
// never diverge. Pure + role-resolved (never a hardcoded code), so renumbering holds.
// ─────────────────────────────────────────────────────────────────────────────

// Map a source TYPE to its natural offset GL account ROLE.
export function glRoleForAccountType(type) {
  if (type === "credit_card") return "credit_card_liability";
  if (type === "loan") return "long_term_debt";
  // ★ C663 — a savings account gets the chart's own Savings Account (1010, role `savings`, already
  // counted in cash on hand). It was filed under Cash with checking, so neither account could ever
  // reconcile on its own — each compared its bank balance with the two accounts' combined books —
  // and a transfer between them was no entry at all (C662).
  if (type === "savings") return "savings";
  return "cash"; // checking / other
}

// Resolve a source TYPE to its default GL CODE. `resolveCode(role)` looks up the
// company's live account code for a role (e.g. getAccountByRole(role)?.code); if it
// can't resolve (legacy COA), fall back to the conventional default code.
export function glCodeForAccountType(type, resolveCode) {
  const role = glRoleForAccountType(type);
  const fallback = role === "credit_card_liability" ? "2200" : role === "long_term_debt" ? "2500" : "1000";
  // a chart without a Savings account keeps savings under Cash, as before — never an invented code
  if (role === "savings") return (resolveCode && (resolveCode("savings") || resolveCode("cash"))) || "1000";
  return (resolveCode && resolveCode(role)) || fallback;
}

// ★ C667 — Settings added every account's entered balance into one green total, so what was OWED
// on a credit card or loan counted as money. Money in the bank and money owed are added up apart.
export function statementBalanceTotals(bankAccounts = []) {
  let inBank = 0, owed = 0;
  for (const b of bankAccounts || []) {
    const v = parseFloat(b && b.current_balance) || 0;
    const liability = b && (b.type === "credit_card" || b.type === "loan" || /^2\d{3}$/.test(String(b.gl_code || "")));
    if (liability) owed += v; else inBank += v;
  }
  const r = (n) => Math.round(n * 100) / 100;
  return { inBank: r(inBank), owed: r(owed) };
}

// ★ C706 — WHICH CATEGORIES A BANK ACCOUNT MAY BE FILED UNDER. Settings offered every asset and
// liability — "Bills you owe", "Money owed to you", sales tax, payroll taxes — so one wrong pick
// sent a bank's money into the wrong place, with nothing on screen saying what the choice does.
// A checking / savings account is cash (10xx); a card is a card liability; a loan is a loan or
// note. The account's current category is always kept in the list, so nothing is silently lost.
const NOT_A_BANK_LIABILITY = new Set(["accounts_payable", "payroll_taxes_payable", "sales_tax_payable", "deferred_revenue", "accrued_liabilities", "lease_liability_current", "lease_liability_noncurrent"]);
export function bankCategoryOptions(accounts = [], type = "checking", current = null) {
  const code = (a) => String(a && a.code);
  const fits = (a) => {
    if (!a) return false;
    if (type === "credit_card") return a.system_role === "credit_card_liability" || (/^2\d{3}$/.test(code(a)) && /\b(card|visa|mastercard|amex|american express|discover)\b/i.test(a.name || "") && !/\bgift\b/i.test(a.name || ""));
    if (type === "loan") return /^2\d{3}$/.test(code(a)) && !NOT_A_BANK_LIABILITY.has(a.system_role) && (["long_term_debt", "notes_payable"].includes(a.system_role) || /\b(loan|note|debt|line of credit|loc|sba|mortgage)\b/i.test(a.name || ""));
    return /^10\d{2}$/.test(code(a)) || ["cash", "savings", "undeposited_funds"].includes(a.system_role);
  };
  const out = (accounts || []).filter(fits);
  if (current != null && !out.some((a) => code(a) === String(current))) {
    const cur = (accounts || []).find((a) => code(a) === String(current));
    if (cur) out.unshift(cur);
  }
  return out;
}

// ★ C713 — EACH BANK ACCOUNT AND CARD IN ITS OWN CATEGORY. Every card got 2200 and every checking
// account 1000 (C663 split out savings only), so a second card shared the first's books: a $9.99
// charge on card B the same day as one on card A read "already booked" and was never recorded, and
// neither card's statement could ever reconcile against the two cards' combined balance. When
// another account already uses `code`, this proposes a free code in the same range, named for the
// account. Null when the account can keep the code. Pure.
export function dedicatedGlFor(acct = {}, bankAccounts = [], chart = []) {
  const code = String(acct.gl_code || "");
  if (!code) return null;
  const others = (bankAccounts || []).filter((b) => b && String(b.id) !== String(acct.id) && String(b.name || "").trim() && String(b.gl_code || "") === code);
  if (!others.length) return null;
  const taken = new Set([...(chart || []).map((a) => String(a.code)), ...(bankAccounts || []).map((b) => String(b.gl_code || ""))]);
  const ranges = code.startsWith("1") ? [[1001, 1009], [1020, 1099]] : code.startsWith("25") ? [[2501, 2599]] : code.startsWith("26") ? [[2601, 2699]] : [[2201, 2299]];
  for (const [lo, hi] of ranges) for (let n = lo; n <= hi; n++) if (!taken.has(String(n))) {
    const base = String(acct.name || "").trim() || (code.startsWith("1") ? "Bank account" : "Credit card");
    const nameTaken = (chart || []).some((a) => String(a.name || "").toLowerCase() === base.toLowerCase());
    return { code: String(n), name: nameTaken ? `${base} (${acct.type === "credit_card" ? "card" : acct.type || "account"})` : base, category: code.startsWith("1") ? "Assets" : "Liabilities" };
  }
  return null;
}
