// ═════════════════════════════════════════════════════════════════════════════
// C596 — A QUICKBOOKS IMPORT RESPECTS THE START DATE. Review finding F4.
//
// CLAUDE.md §12: "No transaction may be dated before the cutoff; pre-cutoff activity is
// represented solely by opening balances." Every other door enforces it (`persistJournalEntry`
// refuses, bank imports skip). The QuickBooks import inserted every row it read, so a full
// history exported from QuickBooks landed on top of starting balances that already summed
// that history up — income, expenses and cash counted twice, and the next attempt to post
// starting balances was blocked by the very rows it had let in.
//
// Rows dated before the start date are set aside, counted, and said — never silently dropped.
// No start date (a legacy company) → nothing is set aside, matching the warn-only rule there.
// ═════════════════════════════════════════════════════════════════════════════
import { isBeforeCutoff } from "./openingBalances.js";

export function splitQboRowsAtCutoff(rows = [], cutoffDate = null) {
  const keep = [], before = [];
  for (const r of rows || []) (isBeforeCutoff(r && r.date, cutoffDate) ? before : keep).push(r);
  return { keep, before };
}

export function qboBeforeCutoffCopy(count, cutoffDate) {
  const n = Number(count) || 0;
  if (!n || !cutoffDate) return null;
  return `${n.toLocaleString("en-US")} row${n === 1 ? " is" : "s are"} dated before your start date (${cutoffDate}) and won't be imported — that history is already in your starting balances, so importing ${n === 1 ? "it" : "them"} would count it twice.`;
}
