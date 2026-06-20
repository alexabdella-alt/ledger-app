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
