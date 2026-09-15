// ─────────────────────────────────────────────────────────────────────────────
// C466 — THE PAID FLAG FOLLOWS THE SETTLEMENT IT RECORDS.
//
// `markBillPaid` posts a payment entry AND stamps `payment_status: "paid"` on the bill.
// Removing that payment — soft-delete, or a dated correction in a signed month — took the
// GL movement out and left the flag in. `apUnpaid` / `openReceivables` (§9's recorded
// exception: the flag still drives the paid/unpaid LISTS) then kept the bill off "Bills to
// pay" while the A/P balance said it was owed — two screens, opposite answers, and the
// `ap_tie` control total red by exactly the deleted payment. Undo of the delete put the
// payment back and the flag was, by luck, still right.
//
// The rule: after any change to the set of live settlements linking a bill or invoice, the
// flag is whatever the LIVE settlements say — paid/collected if one remains, unpaid if none.
// Pure; the caller supplies the ledger and the ids it has just removed (state and refs lag
// a write by a render, so "just removed" is passed explicitly rather than read back).
// ─────────────────────────────────────────────────────────────────────────────
import { isLiveEntry } from "./reports.js";
import { alreadyReversed } from "./ledger.js";

const idOf = (r) => String((r && (r.db_entry_id || r.id)) ?? "");

// The bill or invoice this row settles, or null when it is not a settlement.
export function settlementTargetOf(row) {
  const pf = row && row.import_metadata && row.import_metadata.payment_for;
  if (pf == null || pf === "") return null;
  return { targetId: String(pf), kind: row.import_metadata.kind || null };
}

// Distinct targets among a batch of rows (one bill may have several payments in the batch).
export function settlementTargetsIn(rows) {
  const seen = new Map();
  for (const r of rows || []) {
    const t = settlementTargetOf(r);
    if (t && !seen.has(t.targetId)) seen.set(t.targetId, t);
  }
  return [...seen.values()];
}

// Live settlements still linking `targetId`: posted, not deleted, not reversed, and not in
// `excludeIds` (the ones the caller has just removed or reversed).
export function liveSettlementsFor(entries, targetId, { excludeIds = [] } = {}) {
  const ex = new Set((excludeIds || []).map(String));
  // Excluded rows are invisible for BOTH tests: a settlement in `excludeIds` is gone, and
  // a reversal in `excludeIds` (an undo) no longer counts as reversing anything.
  const visible = (entries || []).filter((r) => !ex.has(idOf(r)));
  const seen = new Set();
  const out = [];
  for (const r of visible) {
    if (!isLiveEntry(r)) continue;
    const t = settlementTargetOf(r);
    if (!t || t.targetId !== String(targetId)) continue;
    const id = idOf(r);
    if (!id || seen.has(id)) continue;
    if (alreadyReversed(visible, id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}

// The flag the target should carry given what remains.
export function flagAfterSettlementChange(kind, remaining) {
  if (remaining > 0) return kind === "ar_collection" ? "collected" : "paid";
  return "unpaid";
}
