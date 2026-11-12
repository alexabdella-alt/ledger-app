// C610 — how a proposed entry on the Review screen is posted. Review finding F9.
// One debit against one equal credit → the ordinary two-line path. Anything else → the
// balanced multi-line path, every line. Debits ≠ credits → refused, never trimmed to fit.
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function reviewEntryPlan(lines = [], { cashCodes = [], cashCode = null } = {}) {
  const live = (lines || []).filter((l) => l && (r2(l.debit) > 0 || r2(l.credit) > 0));
  const dr = live.filter((l) => r2(l.debit) > 0), cr = live.filter((l) => r2(l.credit) > 0);
  const totalDr = r2(dr.reduce((s, l) => s + r2(l.debit), 0)), totalCr = r2(cr.reduce((s, l) => s + r2(l.credit), 0));
  if (!dr.length || !cr.length || totalDr !== totalCr) {
    return { mode: "refuse", why: "That proposed entry doesn't balance, so it wasn't posted. Edit it, or ask your accountant." };
  }
  const cash = new Set([...(cashCodes || []), cashCode].filter((c) => c != null).map(String));
  if (live.length === 2 && dr.length === 1 && cr.length === 1) {
    return { mode: "simple", debit: dr[0], credit: cr[0], total: totalDr, paidFromCash: cash.has(String(cr[0].account_code)) };
  }
  return { mode: "multi", lines: live, total: totalDr };
}
