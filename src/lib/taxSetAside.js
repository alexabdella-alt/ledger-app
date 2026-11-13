// ═════════════════════════════════════════════════════════════════════════════
// ★ C697 / C701 — ONE LINE ON HOME: WHAT TO KEEP BACK FOR TAXES.
// A solo owner's most common surprise is the April bill. The Taxes screen works the figure out;
// Home says it in one sentence, from the same estimate (lib/tax.js taxEstimate): what is still to
// keep aside (this year's tax so far less estimated payments made), as a share of the TAXABLE
// profit, and the next payment in the Taxes screen's own words — "each quarter" only on last
// year's basis, "by the next deadline" when it is pay-as-you-go (C701, review: Home said "pay
// $16,000 each quarter" for a pay-as-you-go figure that already covered the whole year so far).
// Nothing when there is nothing to keep back. Pure.
// ═════════════════════════════════════════════════════════════════════════════
import { fmtApprox } from "./format.js";

export function setAsideLine(est = null) {
  if (!est) return null;
  const owed = Number(est.owed != null ? est.owed : est.total);
  const taxable = Number(est.taxableNet != null ? est.taxableNet : est.net);
  if (!(owed > 0) || !(Number(est.total) > 0) || !(taxable > 0)) return null;
  const pct = Math.min(100, Math.round((Number(est.total) / taxable) * 100));
  const q = Number(est.quarterly) > 0 ? fmtApprox(est.quarterly) : null;
  const next = !q ? "" : est.safeHarbor && est.safeHarbor.basis === "so_far" ? ` Pay about ${q} by the next tax deadline.` : ` Pay about ${q} each quarter.`;
  const paid = Number(est.estPaid) > 0 ? ", after what you've already paid" : "";
  return {
    amount: owed,
    pct,
    text: `Keep about ${fmtApprox(owed)} aside for taxes on this year's profit so far${paid} — roughly ${pct}% of the taxable profit.${next}`,
  };
}
