// ─────────────────────────────────────────────────────────────────────────────
// General journal-entry builders (the remediation home for the universal pattern:
// every economic event's JE is a pure, unit-tested builder, never inline).
//
// buildReversalLines: GAAP reversal — post an OFFSETTING entry that mirrors every
// line's debit/credit; the original entry is KEPT (audit trail), not deleted. A
// reversal is always balanced because swapping debit<->credit on every line
// preserves total debits = total credits. Works for any number of lines
// (multi-line payroll/lease entries included).
//
// NB on the old AI reverse_entry bug this replaces: it both SWAPPED gl_code with
// secondary_gl_code AND flipped debit_credit — a double negation that re-booked an
// identical entry instead of reversing it. Mirroring each line (one operation) is
// the correct transform.
// ─────────────────────────────────────────────────────────────────────────────

const num = n => Number(n) || 0;
const r2 = n => Math.round(num(n) * 100) / 100;

// ─────────────────────────────────────────────────────────────────────────────
// buildJournalEntry — the canonical pure builder for a SINGLE journal entry with
// ANY number of lines. This is the foundation that lets multi-line events
// (deferred-revenue recognition, prepaid amortization, lease commencement,
// payroll, sales-tax invoices) post as ONE balanced journal entry through
// post_journal_entry — NOT as N separate 2-line entries (the per-line expansion
// that double-counted every contract entry, posting revenue on both a primary and
// an offset leg). Accepts code-keyed lines ({code|account_code, debit, credit});
// drops zero-amount lines; reports whether debits = credits. The persist path
// refuses to post anything where `balanced` is false (post_journal_entry also
// validates server-side as a backstop).
// ─────────────────────────────────────────────────────────────────────────────
export function buildJournalEntry({ lines = [], date = null, description = "", source = "manual", memo = null, meta = null } = {}) {
  const norm = (lines || [])
    .map(l => ({
      code: l.code || l.account_code,
      name: l.name || l.account_name || null,
      debit: r2(l.debit),
      credit: r2(l.credit),
      memo: l.memo || memo || null,
    }))
    .filter(l => l.code && (l.debit !== 0 || l.credit !== 0));   // drop empty/zero lines
  const totalDebit = r2(norm.reduce((s, l) => s + l.debit, 0));
  const totalCredit = r2(norm.reduce((s, l) => s + l.credit, 0));
  return {
    date, description, source, meta,
    lines: norm,
    totalDebit, totalCredit,
    // A real entry needs ≥2 lines, a positive total, and debits = credits.
    balanced: norm.length >= 2 && totalDebit === totalCredit && totalDebit > 0,
  };
}

// Given the original entry's GL lines [{account_id, debit, credit, memo}], return
// the reversing lines (debit/credit swapped). Drops zero-amount lines. Pure.
export function buildReversalLines(originalLines) {
  return (originalLines || [])
    .filter(l => num(l.debit) !== 0 || num(l.credit) !== 0)
    .map(l => ({
      account_id: l.account_id,
      debit: num(l.credit),     // swap
      credit: num(l.debit),
      memo: l.memo || null,
    }));
}

// Convenience for tests / callers that think in {code, debit, credit}: same swap,
// preserving whatever key identifies the account.
export function reverseEntryLines(lines) {
  return (lines || [])
    .filter(l => num(l.debit) !== 0 || num(l.credit) !== 0)
    .map(l => ({ ...l, debit: num(l.credit), credit: num(l.debit) }));
}

// ── #17 · YEAR-END CLOSING ENTRY ─────────────────────────────────────────────
//
// Zero every revenue and expense account into Retained Earnings, so the new year starts the
// P&L at nothing. Dr each Revenue / Cr each Expense / plug the difference to `3100`.
//
// ▶ THIS BUILDER HAS NO CALLER, DELIBERATELY, AND THAT MUST NOT BE READ AS AN OVERSIGHT.
// The product does a DERIVED soft close (`fiscalYearSplit`) — prior years' net rolls into
// beginning Retained Earnings without posting anything, which is why the balance sheet has
// been right for multi-year companies since that shipped. **Whether to also POST closing
// entries is an accounting decision about locking a year, not a mechanism gap**, and §12
// records it as such. The builder exists because §12's rule is that every one of the 17
// events has a pure builder with a test asserting exact Dr/Cr — this was the only one
// without — so the decision can now be made without also being a build.
//
// ★★ AND IT MUST NOT BE WIRED WITHOUT THAT DECISION: posting a close is not reversible by
// re-running it, and a second close on the same year would double the roll into Retained
// Earnings while every individual entry still balanced.
//
// `balances` is [{ code, balance }] where `balance` is the account's NORMAL-BALANCE-SIGNED
// figure — revenue positive when earned, expense positive when spent, which is what
// `glAccountBalance` already returns.
export function buildYearEndCloseEntry({ balances = [], retainedEarningsCode, date = null, description = null, memo = null, meta = null } = {}) {
  if (!retainedEarningsCode) return null;
  const isRev = (c) => String(c || "")[0] === "4";
  const isExp = (c) => ["5", "6", "7", "8"].includes(String(c || "")[0]);

  const lines = [];
  let revenue = 0;
  let expense = 0;
  for (const b of balances || []) {
    if (!b || !b.code) continue;
    const amt = r2(b.balance);
    // ★ A ZERO BALANCE PRODUCES NO LINE. An account with nothing in it is already closed, and
    // a zero line would clutter the entry with rows that mean nothing.
    if (!amt) continue;
    if (isRev(b.code)) { revenue = r2(revenue + amt); lines.push({ code: b.code, debit: amt, credit: 0 }); }
    else if (isExp(b.code)) { expense = r2(expense + amt); lines.push({ code: b.code, debit: 0, credit: amt }); }
    // ★★ BALANCE-SHEET ACCOUNTS ARE SILENTLY SKIPPED, and that is correct rather than lax:
    // closing is defined as zeroing the P&L. An asset or liability line here would move a
    // balance that is supposed to CARRY into the new year — the one thing a close must never
    // do. Passing the whole trial balance in is therefore safe.
  }
  if (!lines.length) return null;                      // nothing to close

  const net = r2(revenue - expense);
  // The plug: a profit CREDITS retained earnings, a loss debits it.
  if (net > 0) lines.push({ code: retainedEarningsCode, debit: 0, credit: net });
  else if (net < 0) lines.push({ code: retainedEarningsCode, debit: r2(-net), credit: 0 });
  // ★ A YEAR THAT BROKE EXACTLY EVEN NEEDS NO PLUG, and adding a zero line would be a
  // rounding lie: the revenue and expense lines already balance each other.

  return buildJournalEntry({
    lines, date, source: "manual",
    description: description || "Year-end close",
    memo,
    meta: { ...(meta || { kind: "year_end_close" }), revenue, expense, net },
  });
}
