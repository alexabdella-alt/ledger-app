// ─────────────────────────────────────────────────────────────────────────────
// C452 — ONE DEFINITION OF "AN OPEN RECEIVABLE", read by "Money owed to you" and by the
// Customers screen. An open receivable is an entry that CARRIES the A/R account on a leg
// (an issued invoice), is not itself a settlement (a collection is Dr Cash / Cr A/R), is
// live, and has not been collected. A direct deposit (Dr Cash / Cr Revenue) carries no A/R
// leg — the money is already in the bank — and must never count, whatever its
// payment_status says (§9: openness from the GL leg, never from a flag).
// ─────────────────────────────────────────────────────────────────────────────
// C497 — "carries the A/R account on a leg" was written on the two-line shape. A taxed
// invoice (Dr A/R / Cr Revenue / Cr Sales Tax) flattens to three rows that ALL carry A/R,
// so this listed one invoice three times and owed $2,697 on $1,299. The row that IS the
// receivable is the revenue row whose offset is A/R — `isReceivableRow`, shared with Home's
// card and the KPI strip so the three cannot disagree.
import { isLiveEntry, isReceivableRow } from "./reports.js";
import { isSettlementEntry } from "./bankMatch.js";
import { isCancelledOrCancelling, settledBases, entryBaseOf } from "./gl.js";

// Every issued receivable, settled or not (the aging report's universe).
export function receivableEntries(invoices = [], arCode) {
  if (arCode == null) return [];
  return (invoices || []).filter((i) => isLiveEntry(i) && isReceivableRow(i, arCode) && !isSettlementEntry(i));
}
// The ones still open.
export function openReceivables(invoices = [], arCode) {
  const settled = settledBases(invoices);   // C528 — a live collection linking it closes it, whatever the flag says
  return receivableEntries(invoices, arCode).filter((i) => !isCancelledOrCancelling(i) && i.payment_status !== "collected" && i.payment_status !== "paid" && !settled.has(entryBaseOf(i)));   // C468
}
