// ────────────────────────────────────────────────────────────────────────────
// O105 — OFFER TO FIX THE PAST WHEN YOU FIX A MAPPING (C339).
//
// A person who moves one Sysco entry from Food Cost to Kitchen Supplies has usually told
// us something about Sysco, not about that Tuesday. `learnFromCorrection` already makes
// the NEXT Sysco invoice land right; the eleven already in the books stayed where they
// were, and nothing said so. This plans the offer: the same supplier's other entries that
// sit on the account just left, in months nobody has signed.
//
// ★ A CLOSED MONTH IS NEVER QUIETLY REWRITTEN. Entries in a signed-off month are COUNTED
// and named in the sentence, never moved — a signed month's account mix is what the
// signature attests, and `078` refuses the write at the database anyway. Moving them is
// a dated correction or a reopen, both deliberate acts, neither this button.
//
// ★ SAME SUPPLIER = SAME KEY (O111/C317), never the same spelling. "Hill Country Milling
// Co." and "Hill Country Milling" are one supplier; a sweep keyed on the display name
// would fix half of them and call it done.
//
// Pure. The caller supplies `isSigned(row)` so this module never re-derives the signed-
// period rule — one definition of "signed", in `signedPeriod.js`.
// ────────────────────────────────────────────────────────────────────────────
import { vendorGroupKey } from "./vendorIdentity.js";

const keyOf = (row) => row?.vendor_key || vendorGroupKey(row?.vendor) || null;
const live = (row) => row && !row.deleted_at && row.status !== "deleted" && row.status !== "voided";

export function planRecodeSweep({ rows = [], subject, fromCode, toCode, toName, isSigned = () => false } = {}) {
  const key = keyOf(subject);
  const empty = { eligible: [], blocked: [], sentence: null };
  if (!key || !fromCode || !toCode || String(fromCode) === String(toCode)) return empty;
  const same = (rows || []).filter((r) =>
    live(r) && String(r.id) !== String(subject?.id) && keyOf(r) === key && String(r.gl_code) === String(fromCode));
  const eligible = same.filter((r) => !isSigned(r));
  const blocked = same.filter((r) => isSigned(r));
  if (!eligible.length && !blocked.length) return empty;
  const who = subject?.vendor || "this supplier";
  const target = toName || toCode;
  const n = eligible.length;
  let sentence = null;
  if (n) sentence = `Also change the other ${n} ${who} ${n === 1 ? "entry" : "entries"} to ${target}?`;
  if (blocked.length) {
    const m = blocked.length;
    const tail = `${m} more ${m === 1 ? "is" : "are"} in ${m === 1 ? "a month" : "months"} already signed off and ${m === 1 ? "stays" : "stay"} as ${m === 1 ? "it is" : "they are"}.`;
    sentence = sentence ? `${sentence} ${tail}` : tail;
  }
  return { eligible, blocked, sentence };
}
