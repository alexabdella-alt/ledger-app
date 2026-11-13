// ═════════════════════════════════════════════════════════════════════════════
// ★ C697 — ONE LINE ON HOME: WHAT TO KEEP BACK FOR TAXES.
// A solo owner's most common surprise is the April bill. The Taxes screen works the figure out;
// Home now says it in one sentence, from the same estimate (lib/tax.js taxEstimate): how much of
// this year's profit so far to keep back, as a share of that profit, and the quarterly payment.
// Nothing when there is no tax to keep back (a loss, or no profit yet). Pure.
// ═════════════════════════════════════════════════════════════════════════════
import { fmtApprox } from "./format.js";

export function setAsideLine(est = null) {
  if (!est || !(Number(est.total) > 0) || !(Number(est.net) > 0)) return null;
  const pct = Math.round((Number(est.total) / Number(est.net)) * 100);
  const quarter = Number(est.quarterly) > 0 ? ` Pay about ${fmtApprox(est.quarterly)} each quarter.` : "";
  return {
    amount: Number(est.total),
    pct,
    text: `Keep about ${fmtApprox(est.total)} aside for taxes on this year's profit so far — roughly ${pct}% of it.${quarter}`,
  };
}
