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
