// ─────────────────────────────────────────────────────────────────────────────
// C389 — "NO THANKS" ON A RECURRING SUGGESTION IS REMEMBERED ON THIS DEVICE.
//
// The dismissed set lived in a ref: a reload (or a company switch and back) emptied it, the
// scan found the same pattern, and the card asked again — every month the vendor kept
// charging, after every reload. O122's rule: a card the user sees every month is a bug
// wearing a question mark. C362 fixed the "yes" side (the rule was never written); this is
// the "no" side.
//
// ★ PER-DEVICE, STATED AS A TRADE (the C281 precedent for merge suggestions): a durable
// answer needs a column or a jsonb namespace on the profile, a re-shown suggestion on a
// second device costs one glance, and nothing financial is held here. A "yes" is durable
// by construction — it becomes a recurring rule. Pure helpers around an injected storage
// so the shape is testable; a missing or throwing storage degrades to "nothing declined".
// ─────────────────────────────────────────────────────────────────────────────
export const declinedRecurringKey = (companyId) => `sc_declined_recurring_${companyId || "x"}`;

export function readDeclinedRecurring(storage, companyId) {
  try {
    const raw = storage?.getItem?.(declinedRecurringKey(companyId));
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((k) => typeof k === "string" && k) : []);
  } catch { return new Set(); }
}

export function writeDeclinedRecurring(storage, companyId, set) {
  try { storage?.setItem?.(declinedRecurringKey(companyId), JSON.stringify([...(set || [])])); return true; }
  catch { return false; }
}
