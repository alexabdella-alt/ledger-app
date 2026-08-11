import { describe, it, expect } from "vitest";
import {
  bankStatementLineFingerprint, initialBankLineStatus, bookedBankLineStatus,
  buildStatementRow, buildStatementLineRows, statementPeriod, BANK_LINE_STATUSES, isBankLineStatus,
} from "../src/lib/bankStatements.js";
import { bankTxnKey, bankLineDirection, bookedLineDirection, normalizeBankParse } from "../src/lib/openingBalanceProposal.js";

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
  it("statementPeriod falls back to the min/max line date when the statement states no period", () => {
    expect(statementPeriod(lines)).toMatchObject({ periodStart: "2026-02-05", periodEnd: "2026-02-10", periodStartSource: "span", periodEndSource: "span" });
    expect(statementPeriod([])).toMatchObject({ periodStart: null, periodEnd: null, periodStartSource: "none", periodEndSource: "none" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C198·3c (ii) — THE STATED PERIOD BEATS THE TRANSACTION SPAN.
//
// O87: July persisted as 07-01 → 07-27 (its last transaction) against a statement
// that states a period ending 07-31. The span is an inference standing in for a fact
// the document carries. These hold the preference AND the fallback, because a
// statement that states nothing must still get a period.
// ─────────────────────────────────────────────────────────────────────────────
describe("(ii) statement period — stated first, span as the fallback", () => {
  // JULY'S EXACT SHAPE: activity 07-01 → 07-27, stated period 07-01 → 07-31.
  const july = [
    { date: "2026-07-01", amount: -120 },
    { date: "2026-07-14", amount: 4500 },
    { date: "2026-07-27", amount: -88.4 },
  ];

  it("a last transaction that PREDATES the stated period end does not shorten the period", () => {
    const p = statementPeriod(july, { statedStart: "2026-07-01", statedEnd: "2026-07-31" });
    expect(p.periodEnd).toBe("2026-07-31");            // the stated fact, not 07-27
    expect(p.periodEndSource).toBe("stated");
    expect(p.periodStart).toBe("2026-07-01");
  });

  it("the SAME lines with no stated period still get one — from the span", () => {
    const p = statementPeriod(july);
    expect(p).toMatchObject({ periodStart: "2026-07-01", periodEnd: "2026-07-27", periodEndSource: "span" });
  });

  it("each side falls back independently — a stated end with no stated start", () => {
    const p = statementPeriod(july, { statedEnd: "2026-07-31" });
    expect(p).toMatchObject({ periodStart: "2026-07-01", periodStartSource: "span", periodEnd: "2026-07-31", periodEndSource: "stated" });
  });

  it("a half-read header degrades to the inference, never to null", () => {
    for (const junk of ["", null, "July 2026", "07/31/2026", "2026-07"]) {
      const p = statementPeriod(july, { statedStart: junk, statedEnd: junk });
      expect(p, String(junk)).toMatchObject({ periodStart: "2026-07-01", periodEnd: "2026-07-27", periodEndSource: "span" });
    }
  });

  it("a well-SHAPED non-date is rejected too — it would take the whole insert down", () => {
    // `period_start`/`period_end` are `date` columns. A hallucinated 2026-13-45 passes a
    // naive YYYY-MM-DD regex, Postgres rejects the row, and persistBankStatement swallows
    // that to a console.warn — losing the statement AND every one of its lines, silently.
    for (const bad of ["2026-13-45", "2026-02-31", "2026-00-10", "0000-00-00"]) {
      expect(statementPeriod(july, { statedStart: bad, statedEnd: bad }), bad)
        .toMatchObject({ periodStart: "2026-07-01", periodEnd: "2026-07-27", periodStartSource: "span", periodEndSource: "span" });
    }
  });

  it("★ an INVERTED stated period is distrusted on BOTH sides, not persisted", () => {
    // The span guaranteed min ≤ max for free; one stated side can now break it. An inverted
    // period is worse than an inferred one: reconBooksSet(from > to) returns nothing and
    // reconciliationCoversPeriod can never bracket the month, so the sign-off precondition
    // fails with no visible cause.
    const p = statementPeriod(july, { statedStart: "2026-07-31", statedEnd: "2026-07-01" });
    expect(p).toMatchObject({ periodStart: "2026-07-01", periodEnd: "2026-07-27", periodStartSource: "span", periodEndSource: "span" });
    expect(p.periodStart <= p.periodEnd).toBe(true);
  });

  it("start ≤ end holds for every combination of stated and inferred", () => {
    const vals = [null, "2026-06-28", "2026-07-15", "2026-07-31", "2026-13-45"];
    for (const a of vals) for (const b of vals) {
      const p = statementPeriod(july, { statedStart: a, statedEnd: b });
      if (p.periodStart && p.periodEnd) expect(p.periodStart <= p.periodEnd, `${a} → ${b}`).toBe(true);
    }
  });

  it("a stated period WIDER than the span on both sides is honoured on both sides", () => {
    const p = statementPeriod(july, { statedStart: "2026-06-28", statedEnd: "2026-07-31" });
    expect(p).toMatchObject({ periodStart: "2026-06-28", periodEnd: "2026-07-31", periodStartSource: "stated", periodEndSource: "stated" });
  });

  it("a stated period with NO transactions at all still produces the stated period", () => {
    expect(statementPeriod([], { statedStart: "2026-07-01", statedEnd: "2026-07-31" }))
      .toMatchObject({ periodStart: "2026-07-01", periodEnd: "2026-07-31" });
  });

  it("normalizeBankParse carries period_end through — the side nobody was reading", () => {
    expect(normalizeBankParse({ opening_balance: 100, period_start: "2026-07-01", period_end: "2026-07-31", transactions: july }))
      .toMatchObject({ statedPeriodStart: "2026-07-01", statedPeriodEnd: "2026-07-31" });
    // Legacy bare-array and absent-field shapes normalize to nulls, so the caller spans.
    expect(normalizeBankParse(july).statedPeriodEnd).toBe(null);
    expect(normalizeBankParse({ transactions: july }).statedPeriodEnd).toBe(null);
  });

  it("END TO END — the persisted row keeps the stated end, not the last transaction", () => {
    const { statedPeriodStart, statedPeriodEnd, transactions } =
      normalizeBankParse({ period_start: "2026-07-01", period_end: "2026-07-31", transactions: july });
    const { periodStart, periodEnd } = statementPeriod(transactions, { statedStart: statedPeriodStart, statedEnd: statedPeriodEnd });
    const row = buildStatementRow({ companyId: "co1", periodStart, periodEnd });
    expect(row).toMatchObject({ period_start: "2026-07-01", period_end: "2026-07-31" });
  });
});
