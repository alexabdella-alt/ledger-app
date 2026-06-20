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
