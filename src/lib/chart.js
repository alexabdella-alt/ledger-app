// ─────────────────────────────────────────────────────────────────────────────
// C472 — WHICH ACCOUNTS MAY BE CHOSEN FOR NEW WORK.
//
// The Categories screen has had a "Disable" control (active: false) and the business-type
// template "hides" accounts the same way (C223). Nothing read the flag: every picker on
// every screen, and all seven AI chart slots, listed a disabled account exactly as before.
// `O123`: a control whose effect is invisible will be repeated — or, here, assumed to have
// worked while the model went on booking to the account the person turned off.
//
// The full chart stays the resolver for EXISTING rows (an entry on a disabled account still
// needs its name); this is the list for choosing. Pure.
// ─────────────────────────────────────────────────────────────────────────────
export const bookableAccounts = (chart) => (chart || []).filter((a) => a && a.active !== false);

// Roles the books run on. Disabling one of these would take Cash out of the bank-account
// picker or A/P out of every bill while every write path kept resolving it by role — the
// control would look obeyed and change nothing that matters (`O123`).
export const STRUCTURAL_ROLES = new Set([
  "cash", "savings", "accounts_receivable", "accounts_payable", "accrued_liabilities",
  "sales_tax_payable", "opening_balance_equity", "retained_earnings", "uncategorized_expense",
]);

// Why an account may not be disabled right now, in the owner's words — or null. The caller
// supplies what points at the account; this module never re-derives it.
export function disableAccountBlocker(account, { rules = [], recurring = [], bankAccounts = [] } = {}) {
  if (!account) return null;
  const code = String(account.code);
  if (account.system_role && STRUCTURAL_ROLES.has(account.system_role)) {
    return `${account.name} is one of the categories your books run on, so it can't be turned off.`;
  }
  const byRule = (rules || []).filter((r) => r && String(r.gl_code) === code).map((r) => r.vendor).filter(Boolean);
  if (byRule.length) return `${byRule.length === 1 ? `A supplier rule (${byRule[0]}) points` : `${byRule.length} supplier rules point`} at ${account.name} — change ${byRule.length === 1 ? "that rule" : "those rules"} first.`;
  const byRec = (recurring || []).filter((r) => r && r.active !== false && String(r.gl_code) === code).map((r) => r.name || r.vendor).filter(Boolean);
  if (byRec.length) return `${byRec.length === 1 ? `A recurring charge (${byRec[0]}) is` : `${byRec.length} recurring charges are`} set to ${account.name} — change ${byRec.length === 1 ? "it" : "them"} first.`;
  const byBank = (bankAccounts || []).filter((b) => b && b.active !== false && String(b.gl_code) === code).map((b) => b.name).filter(Boolean);
  if (byBank.length) return `Your bank account ${byBank[0]} is linked to ${account.name} — it can't be turned off.`;
  return null;
}
