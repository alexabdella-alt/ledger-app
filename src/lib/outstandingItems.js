// ─────────────────────────────────────────────────────────────────────────────
// C187 — outstanding-item awareness. A check written last period that HASN'T cleared
// the bank is recorded as an outstanding item on that period's reconciliation. When it
// finally clears, it appears as a debit on THIS period's statement — but the ledger
// entry already exists (booked last period). Booking it again would double-count.
//
// This module recognizes such a statement line as the PRIOR entry CLEARING, not new
// activity: it looks up the latest prior completed reconciliation's outstanding_books
// (§11 reconciliations jsonb), and matches a statement line to a recorded item by exact
// amount + agreeing direction + line-on-or-after the item's date. Pure + tested; the App
// executor stamps the existing entry cleared and books NOTHING.
// ─────────────────────────────────────────────────────────────────────────────
import { bankLineDirection } from "./openingBalanceProposal.js";

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// The outstanding items carried by the LATEST completed reconciliation for THIS account
// whose period ends BEFORE this statement's period start. Account scoping matches
// supersedableOpenReconciliations: by id when present (and not "manual"), else by name.
// Returns normalized candidates [{ jeId, date, amount, signed, description }] (amount is a
// positive magnitude; `signed` carries the cash direction). Empty when there is no prior recon.
export function priorOutstandingCandidates({ reconciliations = [], accountId = null, accountName = null, periodStart = null } = {}) {
  const sameAccount = (r) => (accountId && accountId !== "manual")
    ? String(r.account_id) === String(accountId)
    : String(r.account_name || "") === String(accountName || "");
  const priors = (reconciliations || []).filter((r) =>
    r && String(r.status) === "complete" && sameAccount(r) &&
    r.period_end && (!periodStart || String(r.period_end) < String(periodStart))
  );
  if (!priors.length) return [];
  // Latest = max period_end (tie-break on completed_at) — the most recent prior close carries
  // the live outstanding chain forward.
  priors.sort((a, b) => {
    const pe = String(b.period_end).localeCompare(String(a.period_end));
    return pe !== 0 ? pe : String(b.completed_at || "").localeCompare(String(a.completed_at || ""));
  });
  const arr = Array.isArray(priors[0].outstanding_books) ? priors[0].outstanding_books : [];
  return arr.map((o) => ({
    jeId: o && o.id != null ? String(o.id) : null,
    date: (o && o.date) || null,
    amount: r2(Math.abs(Number(o && o.amount) || 0)),
    signed: Number(o && o.signed) || 0,
    description: (o && o.description) || null,
  }));
}

// Match statement lines against prior outstanding candidates. A match CLEARS the existing
// entry (no new booking):
//   • EXACT amount to the cent (274.99 does NOT clear 275.00), AND
//   • direction agrees with the candidate's cash sign (signed < 0 = money out = 'out'), AND
//   • the line is dated ON OR AFTER the candidate's date (a check clears after it's written).
// MULTISET: each candidate is consumed at most once — two identical outstanding checks need
// two statement lines to clear both. Returns { clears:[{line,candidate}], remainingLines,
// stillOutstanding } (candidates left unconsumed carry forward to the next period's chain).
export function matchOutstandingClears(lines = [], candidates = []) {
  const pool = (candidates || []).map((c) => ({ ...c }));
  const used = new Array(pool.length).fill(false);
  const clears = [];
  const remainingLines = [];
  for (const line of (lines || [])) {
    const lamt = r2(Math.abs(Number(line && line.amount) || 0));
    const ldir = bankLineDirection(line || {});
    const ldate = String((line && (line.date || line.line_date)) || "");
    let idx = -1;
    for (let i = 0; i < pool.length; i++) {
      if (used[i]) continue;
      const c = pool[i];
      if (r2(c.amount) !== lamt) continue;                          // exact amount
      const cdir = c.signed < 0 ? "out" : "in";
      if (cdir !== ldir) continue;                                  // direction must agree
      if (c.date && ldate && ldate < String(c.date)) continue;      // line on/after the item's date
      idx = i; break;
    }
    if (idx >= 0) { used[idx] = true; clears.push({ line, candidate: pool[idx] }); }
    else remainingLines.push(line);
  }
  const stillOutstanding = pool.filter((_, i) => !used[i]);
  return { clears, remainingLines, stillOutstanding };
}

// Sum of the still-outstanding items' signed cash amounts — what feeds reconcileDifference's
// `outstandingSigned` so the chain nets correctly (an uncashed check keeps the books above
// the bank until it clears). Pure.
export function stillOutstandingSigned(stillOutstanding = []) {
  return r2((stillOutstanding || []).reduce((s, o) => s + (Number(o && o.signed) || 0), 0));
}

// Map still-outstanding candidates back to the reconciliations.outstanding_books STORED shape
// (id/date/amount/signed/description) so the chain PROPAGATES into the next completed recon.
export function candidatesToOutstandingBooks(stillOutstanding = []) {
  return (stillOutstanding || []).map((o) => ({
    id: o && o.jeId != null ? String(o.jeId) : null,
    date: (o && o.date) || null,
    amount: r2(Math.abs(Number(o && o.amount) || 0)),
    signed: Number(o && o.signed) || 0,
    description: (o && o.description) || null,
  }));
}
