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
  return "cash"; // checking / savings / other
}

// Resolve a source TYPE to its default GL CODE. `resolveCode(role)` looks up the
// company's live account code for a role (e.g. getAccountByRole(role)?.code); if it
// can't resolve (legacy COA), fall back to the conventional default code.
export function glCodeForAccountType(type, resolveCode) {
  const role = glRoleForAccountType(type);
  const fallback = role === "credit_card_liability" ? "2200" : role === "long_term_debt" ? "2500" : "1000";
  return (resolveCode && resolveCode(role)) || fallback;
}
