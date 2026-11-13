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
