// ─────────────────────────────────────────────────────────────────────────────
// C575 — AN OWNER SEES A CATEGORY'S NAME, NOT ITS NUMBER.
//
// "6100 · Rent & Occupancy" is how an accountant reads a category; to an owner the 6100 is
// noise at best and a reason to think the screen isn't for them at worst. Every owner-facing
// place a category is shown goes through this: the reviewer's seat keeps the code (they sort
// and search by it), the owner's drops it. A category with no name falls back to its code —
// a blank is worse than a number.
// ─────────────────────────────────────────────────────────────────────────────

export function categoryLabel(code, name, { withCode = false, sep = " · " } = {}) {
  const c = code == null ? "" : String(code).trim();
  const n = name == null ? "" : String(name).trim();
  if (!n) return c || "—";
  return withCode && c ? `${c}${sep}${n}` : n;
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
