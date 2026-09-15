// ─────────────────────────────────────────────────────────────────────────────
// C452 — ONE DEFINITION OF "AN OPEN RECEIVABLE", read by "Money owed to you" and by the
// Customers screen. An open receivable is an entry that CARRIES the A/R account on a leg
// (an issued invoice), is not itself a settlement (a collection is Dr Cash / Cr A/R), is
// live, and has not been collected. A direct deposit (Dr Cash / Cr Revenue) carries no A/R
// leg — the money is already in the bank — and must never count, whatever its
// payment_status says (§9: openness from the GL leg, never from a flag).
// ─────────────────────────────────────────────────────────────────────────────
import { isLiveEntry } from "./reports.js";
import { isSettlementEntry } from "./bankMatch.js";

const eq = (a, b) => a != null && b != null && String(a) === String(b);
export const hasArLeg = (i, arCode) => arCode != null && (eq(i?.gl_code, arCode) || eq(i?.secondary_gl_code, arCode));

// Every issued receivable, settled or not (the aging report's universe).
export function receivableEntries(invoices = [], arCode) {
  if (arCode == null) return [];
  return (invoices || []).filter((i) => isLiveEntry(i) && hasArLeg(i, arCode) && !isSettlementEntry(i));
}
// The ones still open.
export function openReceivables(invoices = [], arCode) {
  return receivableEntries(invoices, arCode).filter((i) => i.payment_status !== "collected" && i.payment_status !== "paid");
}
