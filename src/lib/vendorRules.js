// ─────────────────────────────────────────────────────────────────────────────
// C563 — WHICH VENDOR RULE APPLIES TO THIS NAME. Rules matched on the exact name only
// (lower-cased), in four places in the app and one in the answer path. A rule learned from a
// bank line ("SQ *BLUEBONNET LINEN #12") would never fire on the same vendor's invoice
// ("Bluebonnet Linen"), and "Sysco Inc." never matched "SYSCO #4417 TX". Exact name first,
// then the app's own vendor identity — the same key the vendor list groups by, after any
// "also goes by" names a PERSON has added (`aliasIndex`). Never fuzzy: no scoring, no
// "did you mean" — two names meet only where the identity rules or a human say they do.
// ─────────────────────────────────────────────────────────────────────────────
import { entityKeyFor } from "./vendorIdentity.js";
import { applyAlias } from "./vendorAlias.js";

const norm = (s) => String(s || "").trim().toLowerCase();

export function vendorKey(name, aliasIndex = null) {
  const k = entityKeyFor(name);
  return k ? applyAlias(k, aliasIndex) : null;
}

export function ruleForVendor(rules, vendor, { aliasIndex = null } = {}) {
  const list = Array.isArray(rules) ? rules : [];
  const v = norm(vendor);
  if (!v) return null;
  const exact = list.find((r) => r && norm(r.vendor) === v);
  if (exact) return exact;
  const key = vendorKey(vendor, aliasIndex);
  if (!key) return null;
  return list.find((r) => r && r.vendor && vendorKey(r.vendor, aliasIndex) === key) || null;
}
