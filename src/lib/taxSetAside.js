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

// ★ C704 — LAST YEAR'S BALANCE, until April 15. In January this year's profit is near nothing, so
// the line above disappears exactly when last year's tax is due. What's still owed for last year
// (its tax from the books, less the estimated payments recorded for it). Nothing when nothing is owed.
// C706 (audit) — say when the books cover only part of that year, and mention payments only
// when some were recorded.
export function lastYearBalanceLine(est = null, year, { cutoffDate = null } = {}) {
  if (!est || !(Number(est.owed) > 0) || !(Number(est.total) > 0)) return null;
  const paid = Number(est.estPaid) > 0 ? ", after the estimated payments you recorded" : "";
  const partial = cutoffDate && String(cutoffDate).startsWith(`${year}-`) && String(cutoffDate) > `${year}-01-01`
    ? ` Your books start on ${cutoffDate}, so this covers only part of ${year} — your tax return will have the full figure.` : "";
  return { amount: Number(est.owed), text: `For ${year}: about ${fmtApprox(est.owed)} of tax is still to pay by April 15${paid}.${partial}` };
}

// ★ C780 — "PUT ABOUT $X OF IT ASIDE": the moment money comes in is when a solo owner can still keep
// some back. The figure is what THIS payment adds to the year's estimated tax — the same estimate
// with and without it (lib/tax.js taxEstimate), never a flat percentage — so a year whose costs
// still exceed its income honestly says nothing is needed yet. Pure.
export function paymentSetAsideLine({ before = null, after = null, amount = 0 } = {}) {
  const amt = Number(amount) || 0;
  if (!(amt > 0) || !before || !after) return null;
  const extra = Math.max(0, (Number(after.total) || 0) - (Number(before.total) || 0));
  if (extra < 1) return { amount: 0, text: "No tax to set aside from this one yet, going by this year's books so far." };
  const pct = Math.min(100, Math.round((extra / amt) * 100));
  return { amount: extra, text: `Put about ${fmtApprox(extra)} of it aside for taxes — roughly what it adds to this year's tax bill (about ${pct}%).` };
}
