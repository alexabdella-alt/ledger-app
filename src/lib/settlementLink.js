// ─────────────────────────────────────────────────────────────────────────────
// Bidirectional settlement ↔ original linkage (O-link).
//
// A matching settlement entry (a collection that cleared an A/R invoice, or a
// payment that cleared an A/P bill) carries, in its journal entry's
// import_metadata: { kind: "ar_collection"|"ap_payment", payment_for: <original
// JE id> }. markBillPaid writes payment_for = String(<bill/invoice db id>), and the
// ORIGINAL bill/invoice flattens to a row whose db_entry_id IS that same JE id.
// So the two directions are pure lookups over the (flattened) invoices array:
//
//   clearedOriginal(settlement)  → the bill/invoice it cleared   (settlement → original)
//   clearingSettlement(original) → the collection/payment that cleared it (original → settlement)
//
// Both return null when there is no link (no metadata, not a settlement, or the
// counterpart isn't loaded), so the UI shows the link only when it genuinely exists.
// ─────────────────────────────────────────────────────────────────────────────
import { settlementKind } from "./txnPresent";

const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const absAmt = (i) => Math.abs(Number(i && i.amount) || 0);

// Settlement → the original bill/invoice it cleared.
export function clearedOriginal(sel, invoices = []) {
  const kind = settlementKind(sel);
  if (!kind) return null;
  const targetId = sel && sel.import_metadata && sel.import_metadata.payment_for;
  if (targetId == null) return null;
  const orig = (invoices || []).find((i) => i && i.id !== sel.id && sameId(i.db_entry_id, targetId));
  if (!orig) return null;
  return {
    kind,                                   // "ar_collection" | "ap_payment"
    docNoun: kind === "ar_collection" ? "invoice" : "bill",
    target: orig,
    id: orig.id,                            // the flattened-row id to navigate to
    vendor: orig.vendor || orig.description || "transaction",
    amount: absAmt(orig),
    date: orig.date || null,
  };
}

// Original bill/invoice → the collection/payment that settled it (if any).
export function clearingSettlement(sel, invoices = []) {
  if (!sel || sel.db_entry_id == null) return null;
  if (settlementKind(sel)) return null;     // a settlement isn't itself "settled by" something
  const s = (invoices || []).find((i) => {
    if (!i || i.id === sel.id) return false;
    const k = settlementKind(i);
    if (!k) return false;
    const pf = i.import_metadata && i.import_metadata.payment_for;
    return pf != null && sameId(pf, sel.db_entry_id);
  });
  if (!s) return null;
  const kind = settlementKind(s);
  return {
    kind,
    actionNoun: kind === "ar_collection" ? "collection" : "payment",
    target: s,
    id: s.id,
    amount: absAmt(s),
    date: s.date || null,
  };
}
