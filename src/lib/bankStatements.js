// ─────────────────────────────────────────────────────────────────────────────
// C185 — Bank-statement persistence foundation (§11 ★ North Star, Phase 1-A).
//
// Pure helpers for turning parsed statement lines into durable DB records. NO I/O
// here — the App wraps these in the actual Supabase inserts/updates so the shapes
// and the dedup/status identity are unit-testable in isolation.
//
// The fingerprint is the SAME content-dedup identity markAlreadyBooked uses
// (date | abs(amount) | direction — openingBalanceProposal.bankTxnKey), so a
// persisted statement line and the ledger entry it eventually becomes share ONE
// key. That's what lets the (next-commit) pipeline reconcile lines↔entries by
// fingerprint instead of re-parsing.
// ─────────────────────────────────────────────────────────────────────────────
import { bankTxnKey, bankLineDirection } from "./openingBalanceProposal.js";
import { isSettlementEntry } from "./bankMatch.js";

// The content-dedup fingerprint for a parsed statement line — IDENTICAL to what
// markAlreadyBooked keys on (bankTxnKey with the line's derived direction).
export function bankStatementLineFingerprint(line = {}) {
  return bankTxnKey({ date: line.date, amount: line.amount, direction: bankLineDirection(line) });
}

// The valid persisted statuses for a statement line (mirrors the 058 CHECK).
export const BANK_LINE_STATUSES = ["pending", "booked", "matched", "already_booked", "excepted"];
export const isBankLineStatus = (s) => BANK_LINE_STATUSES.includes(s);

// A parsed line's INITIAL persisted status: an already-booked (re-upload dedup) line is
// 'already_booked' — the ledger already holds it, nothing more to do; everything else
// starts 'pending' and the booking flow advances it.
export function initialBankLineStatus(line = {}) {
  return line && line.already_booked ? "already_booked" : "pending";
}

// The status a line takes once its ledger entry exists: a SETTLEMENT/clearing entry (one
// that pays FOR an open bill/invoice — import_metadata.payment_for) → 'matched'; a plain
// direct booking → 'booked'. GL-truth (isSettlementEntry), never a flag. Pure.
export function bookedBankLineStatus(entry = {}) {
  return isSettlementEntry(entry) ? "matched" : "booked";
}

// Pure row-shape builder for the bank_statements insert (no I/O).
export function buildStatementRow({
  companyId, bankAccountId = null, documentId = null, periodStart = null, periodEnd = null,
  statedOpening = null, statedEnding = null, sourceFilename = null, status = "parsed",
} = {}) {
  return {
    company_id: companyId,
    bank_account_id: bankAccountId || null,
    document_id: documentId || null,
    period_start: periodStart || null,
    period_end: periodEnd || null,
    stated_opening_balance: statedOpening != null ? statedOpening : null,
    stated_ending_balance: statedEnding != null ? statedEnding : null,
    source_filename: sourceFilename || null,
    status,
  };
}

// Pure row-shape builder for the bank_statement_lines insert (no I/O). One row per parsed line.
export function buildStatementLineRows(lines = [], { companyId, statementId } = {}) {
  return (lines || []).map((t) => ({
    statement_id: statementId,
    company_id: companyId,
    line_date: t.date || null,
    description: t.description || null,
    vendor: t.vendor || null,
    amount: Number(t.amount) || 0,
    direction: bankLineDirection(t),
    fingerprint: bankStatementLineFingerprint(t),
    status: initialBankLineStatus(t),
    ai_gl_code: t.gl_code || null,
    ai_confidence: t.confidence != null ? Number(t.confidence) : null,
  }));
}

// Period span (min/max line date) for a set of parsed lines — deriveStatementOpening gives the
// start but not the end, so the persist path uses this for period_end. Pure.
export function statementPeriod(lines = []) {
  const dates = (lines || []).map((t) => String(t && t.date || "").slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return { periodStart: dates[0] || null, periodEnd: dates[dates.length - 1] || null };
}
