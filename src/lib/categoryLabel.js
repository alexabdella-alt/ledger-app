// ─────────────────────────────────────────────────────────────────────────────
// C575 — AN OWNER SEES A CATEGORY'S NAME, NOT ITS NUMBER.
//
// "6100 · Rent & Occupancy" is how an accountant reads a category; to an owner the 6100 is
// noise at best and a reason to think the screen isn't for them at worst. Every owner-facing
// place a category is shown goes through this: the reviewer's seat keeps the code (they sort
// and search by it), the owner's drops it. A category with no name falls back to its code —
// a blank is worse than a number.
// ─────────────────────────────────────────────────────────────────────────────

// ★ C643 — THE STANDARD BOOKKEEPING ACCOUNTS, IN AN OWNER'S WORDS. The built-in balance-sheet
// accounts kept their textbook names on the owner's seat — "Accounts Payable" as a payment's
// category in Money, "Sales Tax Payable" on Starting balances, "Accounts Receivable" in the bank
// account picker. Only the DEFAULT names are translated (a name the owner typed is theirs and
// shows as typed), and only on the owner's seat; the accountant sees the account's own name.
const OWNER_NAMES = {
  "accounts payable": "Bills you owe",
  "accounts receivable": "Money owed to you",
  "sales tax payable": "Sales tax you've collected",
  "payroll taxes payable": "Payroll taxes to pay",
  "opening balance equity": "Starting equity",
  "accrued liabilities": "Costs not billed yet",
  "deferred revenue": "Paid in advance by customers",
  "retained earnings": "Profit kept in the business",
  "accumulated depreciation": "Wear and tear so far",
  "prepaid expenses": "Paid in advance",
  // C655 — the accounts the owner's-money, card, transfer and loan answers write to
  "notes payable": "Loans you owe",
  "long-term debt": "Long-term loans",
  "owner's draw / distributions": "Money you've taken out",
  "additional paid-in capital": "Money put in by owners",
  "owner contributions": "Money you've put in",
  "credit card liability": "Owed on credit cards",
  "loans": "Loans you owe",
};
export function ownerAccountName(name) {
  const n = name == null ? "" : String(name).trim();
  return OWNER_NAMES[n.toLowerCase()] || n;
}

export function categoryLabel(code, name, { withCode = false, sep = " · " } = {}) {
  const c = code == null ? "" : String(code).trim();
  const n = name == null ? "" : String(name).trim();
  if (!n) return c || "—";
  return withCode && c ? `${c}${sep}${n}` : ownerAccountName(n);   // C643 — the owner's seat reads plain words
}

// The seat rule every view already uses for the cockpit: unknown seat = reviewer (the safe
// default for a screen built for both), an owner seat = no codes.
export const showCodesFor = (navSeat) => (navSeat ? !!navSeat.isReviewerSeat : true);

// C578 — the four-digit number a new category needs, chosen for the person instead of asked
// of them. The first free code in its type's range (1xxx has, 2xxx owes, 3xxx owner's share,
// 4xxx income, 6xxx–7xxx costs), stepping by 10 so it sits beside its neighbours the way an
// accountant would number it; null only if the whole range is taken.
const RANGES = { Assets: [1000, 1999], Liabilities: [2000, 2999], Equity: [3000, 3999], Revenue: [4000, 4999], Expenses: [6000, 7999] };
export function nextFreeCode(category, chart = []) {
  const r = RANGES[category];
  if (!r) return null;
  const used = new Set((chart || []).map((a) => String(a && a.code)));
  for (let c = r[0]; c <= r[1]; c += 10) if (!used.has(String(c))) return String(c);
  for (let c = r[0]; c <= r[1]; c += 1) if (!used.has(String(c))) return String(c);
  return null;
}

// The five kinds of category, as an owner would name them.
export const CATEGORY_KIND_LABEL = {
  Expenses: "COSTS", Revenue: "INCOME", Assets: "WHAT THE BUSINESS HAS", Liabilities: "WHAT THE BUSINESS OWES", Equity: "OWNER'S SHARE",
};
export const CATEGORY_KIND_OPTION = {
  Expenses: "A cost (money going out)", Revenue: "Income (money coming in)", Assets: "Something the business has",
  Liabilities: "Something the business owes", Equity: "The owner's share",
};

// The code a new category is saved with: what the person typed, or — left blank, which is the
// only option an owner has — the next free one for its type.
export function codeForNewCategory(draft = {}, chart = []) {
  return String(draft.code || "").trim() || nextFreeCode(draft.category, chart);
}
