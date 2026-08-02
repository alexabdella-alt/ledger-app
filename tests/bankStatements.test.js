import { describe, it, expect } from "vitest";
import {
  bankStatementLineFingerprint, initialBankLineStatus, bookedBankLineStatus,
  buildStatementRow, buildStatementLineRows, statementPeriod, BANK_LINE_STATUSES, isBankLineStatus,
} from "../src/lib/bankStatements.js";
import { bankTxnKey, bankLineDirection, bookedLineDirection } from "../src/lib/openingBalanceProposal.js";

// ════════════════════════════════════════════════════════════════════════════
// C185 — bank-statement persistence foundation. The fingerprint MUST equal the
// markAlreadyBooked dedup identity (date | abs(amount) | direction) so a persisted
// statement line and the ledger entry it becomes share one key (the pipeline
// reconciles by fingerprint, not by re-parsing).
// ════════════════════════════════════════════════════════════════════════════

describe("bankStatementLineFingerprint — matches the markAlreadyBooked dedup identity", () => {
  it("equals bankTxnKey(date | abs(amount) | direction) for the same line", () => {
    const line = { date: "2026-02-10", amount: -512.35, type: "expense", vendor: "Roma" };
    expect(bankStatementLineFingerprint(line)).toBe(bankTxnKey({ date: line.date, amount: line.amount, direction: bankLineDirection(line) }));
  });
  it("same line → same fingerprint (stable / idempotent)", () => {
    const line = { date: "2026-02-10", amount: 900, type: "revenue", vendor: "Toast POS" };
    expect(bankStatementLineFingerprint(line)).toBe(bankStatementLineFingerprint({ ...line }));
  });
  it("a parsed deposit and its BOOKED ledger entry (Dr Cash / Cr Revenue) share one fingerprint", () => {
    // parse side (money in)
    const parsed = { date: "2026-02-10", amount: 900, type: "revenue", vendor: "Toast POS" };
    // booked side: Dr Cash(1000) / Cr Revenue(4000) — cash on the offset leg, flattened P&L-primary
    const booked = { date: "2026-02-10", amount: 900, gl_code: "4000", secondary_gl_code: "1000", debit_credit: "credit" };
    const ledgerFp = bankTxnKey({ date: booked.date, amount: booked.amount, direction: bookedLineDirection(booked, "1000") });
    expect(bankStatementLineFingerprint(parsed)).toBe(ledgerFp);   // dedup identity aligns → no double-book
  });
  it("direction distinguishes a same-day same-amount deposit from a withdrawal", () => {
    const deposit = { date: "2026-02-10", amount: 500, type: "revenue" };
    const withdrawal = { date: "2026-02-10", amount: 500, type: "expense" };
    expect(bankStatementLineFingerprint(deposit)).not.toBe(bankStatementLineFingerprint(withdrawal));
  });
});

describe("status transitions", () => {
  it("initialBankLineStatus: already-booked → 'already_booked', else 'pending'", () => {
    expect(initialBankLineStatus({ already_booked: true })).toBe("already_booked");
    expect(initialBankLineStatus({ already_booked: false })).toBe("pending");
    expect(initialBankLineStatus({})).toBe("pending");
  });
  it("bookedBankLineStatus: a settlement/clearing entry → 'matched', a direct booking → 'booked'", () => {
    const clearing = { import_metadata: { payment_for: "bill-1" } };   // pays for a bill → matched
    const direct = { import_metadata: null, gl_code: "6000" };          // plain expense booking → booked
    expect(bookedBankLineStatus(clearing)).toBe("matched");
    expect(bookedBankLineStatus(direct)).toBe("booked");
  });
  it("every produced status is in the migration's CHECK set", () => {
    expect(isBankLineStatus(initialBankLineStatus({ already_booked: true }))).toBe(true);
    expect(isBankLineStatus(bookedBankLineStatus({ import_metadata: { payment_for: "x" } }))).toBe(true);
    expect(BANK_LINE_STATUSES).toEqual(["pending", "booked", "matched", "already_booked", "excepted"]);
  });
});

describe("row-shape builders (pure, no I/O)", () => {
  const lines = [
    { date: "2026-02-05", amount: -512.35, type: "expense", vendor: "Roma", description: "Roma cheese", gl_code: "5000", confidence: 88 },
    { date: "2026-02-10", amount: 900, type: "revenue", vendor: "Toast POS", gl_code: "4000", confidence: 95, already_booked: true },
  ];
  it("buildStatementRow carries the account/document/period/balances/status", () => {
    const row = buildStatementRow({ companyId: "co1", bankAccountId: "acc1", documentId: "doc1", periodStart: "2026-02-05", periodEnd: "2026-02-28", statedOpening: 20614.40, statedEnding: 20339.40, sourceFilename: "feb.pdf" });
    expect(row).toMatchObject({ company_id: "co1", bank_account_id: "acc1", document_id: "doc1", period_start: "2026-02-05", period_end: "2026-02-28", stated_opening_balance: 20614.40, stated_ending_balance: 20339.40, source_filename: "feb.pdf", status: "parsed" });
  });
  it("buildStatementLineRows sets direction, fingerprint, initial status, ai fields", () => {
    const rows = buildStatementLineRows(lines, { companyId: "co1", statementId: "stmt1" });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ statement_id: "stmt1", company_id: "co1", line_date: "2026-02-05", direction: "out", status: "pending", ai_gl_code: "5000", ai_confidence: 88 });
    expect(rows[0].fingerprint).toBe(bankStatementLineFingerprint(lines[0]));
    expect(rows[1]).toMatchObject({ direction: "in", status: "already_booked", ai_gl_code: "4000", ai_confidence: 95 });   // already-booked line
  });
  it("statementPeriod returns the min/max line date", () => {
    expect(statementPeriod(lines)).toEqual({ periodStart: "2026-02-05", periodEnd: "2026-02-10" });
    expect(statementPeriod([])).toEqual({ periodStart: null, periodEnd: null });
  });
});
