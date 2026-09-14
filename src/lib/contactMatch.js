// ─────────────────────────────────────────────────────────────────────────────
// WHICH CONTACT AN EXTRACTED VENDOR NAME BELONGS TO (C366).
//
// `createOrUpdateContact` — the path every uploaded invoice's vendor details take — found
// the existing contact with `cn === n || cn.includes(n) || n.includes(cn)` over squashed
// lower-case names. Substring CONTAINMENT is the one-way door this codebase's vendor-identity
// tests exist to forbid: an invoice from "SYSCO FUEL" found the "SYSCO" contact, filled its
// empty email, phone and gl_code with the fuel supplier's, and no "SYSCO FUEL" contact was
// ever created — so the Vendors tab showed a ledger group with no contact beside a contact
// wearing another business's details. A fourth implementation of vendor identity (O125's
// count), one subsystem over from the three already merged.
//
// One rule now, and it is the SAME rule the Vendors tab joins on (C317): the canonical
// group key, through the person-asserted alias index. Exact, never contained.
// ─────────────────────────────────────────────────────────────────────────────
import { vendorGroupKey } from "./vendorIdentity";
import { applyAlias } from "./vendorAlias";

export function contactKeyFor(name, aliasIndex) {
  const k = vendorGroupKey(name) || String(name || "").trim().toLowerCase();
  return k ? applyAlias(k, aliasIndex) : null;
}

// The existing contact this name is the same business as, or null. Null means "make one".
export function findContactForName(contacts = [], name, aliasIndex) {
  const k = contactKeyFor(name, aliasIndex);
  if (!k) return null;
  return (contacts || []).find((c) => c && contactKeyFor(c.name, aliasIndex) === k) || null;
}
