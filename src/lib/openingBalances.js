// ─────────────────────────────────────────────────────────────────────────────
// Clean-cutoff opening balances (governing principle).
//
// Every company has ONE cutoff/conversion date ("Day One"). The complete starting
// position is ONE balanced opening journal entry as of the cutoff — the prior
// trial balance (assets, liabilities, already-accumulated retained earnings),
// plugging any residual to Opening Balance Equity (3400). No transaction may be
// dated before the cutoff; pre-cutoff activity is represented solely by opening
// balances. This makes the retained-earnings double-count structurally impossible.
//
// Bank/cash opening positions flow through the SAME entry (the bank balance is the
// opening balance of that bank's cash GL account) — keyed by GL account so nothing
// is opened twice.
// ─────────────────────────────────────────────────────────────────────────────

export const OBE_CODE = "3400";              // Opening Balance Equity (default code)
export const OBE_ROLE = "opening_balance_equity";

const num = n => Number(n) || 0;
const r2 = n => Math.round(num(n) * 100) / 100;

const categoryFromCode = (code) => {
  const d = String(code || "")[0];
  return d === "1" ? "Assets" : d === "2" ? "Liabilities" : d === "3" ? "Equity"
    : d === "4" ? "Revenue" : ["5", "6", "7", "8"].includes(d) ? "Expenses" : null;
};

// Build ONE balanced opening journal entry from the prior trial balance.
// `balancesByCode`: { code: signed natural balance } — a positive value sits on the
// account's NORMAL side (assets debit-natural; liabilities/equity credit-natural).
// Returns { date, source:'opening_balance', lines:[{code,debit,credit}] }; the
// residual is plugged to Opening Balance Equity so debits = credits exactly.
export function buildOpeningBalanceEntry(balancesByCode, { cutoffDate = null, obeCode = OBE_CODE, accounts = [] } = {}) {
  const catOf = (code) => accounts.find(a => a.code === code)?.category || categoryFromCode(code);
  const lines = [];
  let totalDebit = 0, totalCredit = 0;

  for (const [code, raw] of Object.entries(balancesByCode || {})) {
    if (!code || code === obeCode) continue;          // OBE is the plug, added last
    const bal = r2(raw);
    if (bal === 0) continue;
    const cat = catOf(code);
    const debitNatural = cat === "Assets" || cat === "Expenses";
    // Positive balance → natural side; negative → the opposite side.
    const onDebit = debitNatural ? bal >= 0 : bal < 0;
    const amt = Math.abs(bal);
    if (onDebit) { lines.push({ code, debit: amt, credit: 0 }); totalDebit += amt; }
    else { lines.push({ code, debit: 0, credit: amt }); totalCredit += amt; }
  }

  const plug = r2(totalDebit - totalCredit);
  if (plug > 0) lines.push({ code: obeCode, debit: 0, credit: plug });        // assets exceed L+E → credit OBE
  else if (plug < 0) lines.push({ code: obeCode, debit: -plug, credit: 0 });  // L+E exceed assets → debit OBE

  return { date: cutoffDate, source: "opening_balance", lines };
}

// ── Cutoff enforcement (pure predicates) ────────────────────────────────────
// A transaction dated before the cutoff is, by definition, part of the opening
// position — the UI must redirect the user to opening balances, not book it.
export function isBeforeCutoff(date, cutoffDate) {
  if (!cutoffDate || !date) return false;
  return String(date) < String(cutoffDate);
}

// The double-count footgun: live, non-opening transactions dated before the cutoff.
// Posting opening balances while these exist would double-count retained earnings.
export function preCutoffActivity(entries, cutoffDate) {
  if (!cutoffDate) return [];
  return (entries || []).filter(e => {
    if (!e || e.source === "opening_balance") return false;
    if (e.status === "voided" || e.status === "deleted" || e.deleted_at) return false;
    const d = String(e.date || e.entry_date || "");
    return d !== "" && d < String(cutoffDate);
  });
}
export const hasPreCutoffActivity = (entries, cutoffDate) => preCutoffActivity(entries, cutoffDate).length > 0;

// The standard redirect message for a rejected pre-cutoff booking.
export const PRE_CUTOFF_MESSAGE =
  "This is dated before your cutoff — record it by adjusting your opening balances, not as a new transaction.";
