// ─────────────────────────────────────────────────────────────────────────────
// O111 — TELLING US THAT TWO NAMES ARE ONE SUPPLIER.
//
// The live case: Franklin Ave Properties. The bank line reads
// `ACH DEBIT - FRANKLIN AVE PROPERTIES LP RENT` and the invoice reads
// `Franklin Ave Properties`. Rail-stripping removes transport noise (`ACH DEBIT -`) and
// legal suffixes (`LP`), but the bank descriptor also carries a PURPOSE word — `RENT` —
// which describes what the payment was FOR, not who it was TO. So the two doors produce
// `franklin ave properties rent` and `franklin ave properties`, and the vendor splits.
//
// ★★ THE FIX IS NOT MORE STRING SURGERY, AND THAT DECISION IS THE WHOLE DESIGN. Stripping
// trailing words like RENT / FEES / SERVICES would also eat real vendor names — "Lone Star
// Restaurant **Supply**", "Bluebonnet Linen **Service**". §11 records this exact reasoning
// for the Toast month-name split, where the answer was recognition rather than surgery.
// **A wrong merge is a ONE-WAY DOOR**: it launders one vendor's attested mapping onto
// another's charges, silently. So the merge has to be asserted by a person, once.
//
// ★ ALIASES ARE A PER-COMPANY FACT, NOT A GLOBAL ONE. That "Franklin Ave Properties LP
// Rent" is your landlord is true of YOUR books and nobody else's — unlike the universal
// directory (`066`), which holds vendors every tenant shares and is admin-write-only for
// exactly that reason.
//
// Pure. The resolution step is a Map lookup, deliberately: no scoring, no fuzzy match, no
// "did you mean". A suggestion engine is O106 and is a different feature with a different
// risk profile — this one only ever applies a mapping a human has already asserted.
// ─────────────────────────────────────────────────────────────────────────────

import { entityKeyFor } from "./vendorIdentity.js";

// contacts rows: { id, name, aliases: string[] }
// Returns Map<aliasKey, { key, name, contactId }> — alias key → the CANONICAL identity.
export function buildAliasIndex(contacts = []) {
  const index = new Map();
  for (const c of contacts || []) {
    if (!c || !c.name) continue;
    const canonical = entityKeyFor(c.name);
    if (!canonical) continue;
    for (const raw of c.aliases || []) {
      const aliasKey = entityKeyFor(raw);
      if (!aliasKey || aliasKey === canonical) continue;
      // ★ FIRST WRITER WINS, AND A COLLISION IS REPORTED RATHER THAN RESOLVED. Two contacts
      // claiming one alias is a curation error the person has to settle — picking one
      // silently is how a vendor's charges start landing on someone else's account.
      if (index.has(aliasKey)) { index.get(aliasKey).conflict = true; continue; }
      index.set(aliasKey, { key: canonical, name: c.name, contactId: c.id ?? null, conflict: false });
    }
  }
  return index;
}

// Apply the index to a resolved key. Returns the canonical key, or the input unchanged.
export function applyAlias(key, index) {
  if (!key || !index) return key;
  const hit = index.get(key);
  // A conflicted alias resolves to NOTHING extra — it is left as itself, so the vendor
  // stays split (visible) rather than being merged onto a coin-flip winner (silent).
  if (!hit || hit.conflict) return key;
  return hit.key;
}

// Curation hygiene, surfaced rather than swallowed. Same shape as the directory's
// `directoryConflicts()`: two people claiming one alias is worse than no alias at all.
export function aliasConflicts(contacts = []) {
  const claims = new Map();
  for (const c of contacts || []) {
    if (!c || !c.name) continue;
    for (const raw of c.aliases || []) {
      const k = entityKeyFor(raw);
      if (!k) continue;
      (claims.get(k) || claims.set(k, []).get(k)).push(c.name);
    }
  }
  return [...claims.entries()]
    .filter(([, names]) => new Set(names).size > 1)
    .map(([key, names]) => ({ key, names: [...new Set(names)] }));
}

// ── WHAT A PERSON MAY ASSERT ────────────────────────────────────────────────
export const ALIAS_REJECT = {
  EMPTY: "empty",
  SELF: "self",            // the alias resolves to the contact's own name
  UNKEYABLE: "unkeyable",  // no letters — "123456" or "&&&" is not a vendor name
  TAKEN: "taken",          // another contact already claims it
  DUPLICATE: "duplicate",  // this contact already has it
};

// Validates a proposed alias and returns a plain-language reason when it is refused.
// `others` is every OTHER contact, so "taken" can name who has it.
export function validateAlias(raw, contact = {}, others = []) {
  const text = String(raw == null ? "" : raw).trim();
  if (!text) return { ok: false, reason: ALIAS_REJECT.EMPTY, message: "Type the other name first." };

  const key = entityKeyFor(text);
  // ★ THE UNKEYABLE GUARD IS THE PHANTOM-VENDOR DOOR (C209). A descriptor made only of
  // punctuation or digits normalises to something that is not a name, and accepting it
  // would mint an identity keyed on noise.
  if (!key || !/[a-z]/i.test(key)) {
    return { ok: false, reason: ALIAS_REJECT.UNKEYABLE, message: "That doesn't look like a supplier name." };
  }

  const own = entityKeyFor(contact.name);
  if (own && key === own) {
    return { ok: false, reason: ALIAS_REJECT.SELF, message: `That's already how we read ${contact.name}.` };
  }
  if ((contact.aliases || []).some((a) => entityKeyFor(a) === key)) {
    return { ok: false, reason: ALIAS_REJECT.DUPLICATE, message: "You've already added that one." };
  }
  const clash = (others || []).find((o) =>
    o && o.id !== contact.id && ((entityKeyFor(o.name) === key) || (o.aliases || []).some((a) => entityKeyFor(a) === key)));
  if (clash) {
    return { ok: false, reason: ALIAS_REJECT.TAKEN, message: `${clash.name} already goes by that name.` };
  }
  return { ok: true, reason: null, message: null, key, text };
}

// The sentence under the input. Reads the CONTACT, so it cannot describe a merge that is
// not the one being made (§9).
export function aliasExplainer(contact = {}) {
  const n = (contact.aliases || []).length;
  if (!n) return `If ${contact.name || "this supplier"} shows up on your bank statement under a different name, add it here and we'll treat them as one.`;
  return `We'll treat ${n} other name${n === 1 ? "" : "s"} as ${contact.name || "this supplier"}.`;
}
