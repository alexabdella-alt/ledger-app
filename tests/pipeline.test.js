import { describe, it, expect } from "vitest";
import { planStatementPipeline, DEFAULT_AUTO_BOOK_FLOOR } from "../src/lib/pipeline.js";

// ════════════════════════════════════════════════════════════════════════════
// C186 — the clean-path pipeline PLANNER. Pure partition: auto-book-safe lines vs
// exceptions (never book silently), and whether to attempt a reconciliation.
// ════════════════════════════════════════════════════════════════════════════
const FLOOR = 85;   // AI_CONFIDENCE_AUTO_BOOK
const th = { autoBookFloor: FLOOR };
// A February statement (open month) unless a fixture says otherwise.
const febStmt = { period_start: "2026-02-01", period_end: "2026-02-28", stated_ending_balance: 20614.40 };
const line = (over = {}) => ({ id: over.id || "L", line_date: "2026-02-10", amount: -100, direction: "out", vendor: "V", ai_gl_code: "6000", ai_confidence: 95, status: "pending", ...over });

describe("partition by confidence floor + needs_review", () => {
  it("confident, not-already-booked, open-month line → toBook", () => {
    const p = planStatementPipeline({ lines: [line({ id: "a", ai_confidence: 95 })], statement: febStmt, thresholds: th });
    expect(p.toBook.map(l => l.id)).toEqual(["a"]);
    expect(p.exceptions).toEqual([]);
    expect(p.toMatch).toEqual(p.toBook);      // the same set feeds the downstream matcher
  });
  it("below the floor → exception 'low_confidence', never toBook", () => {
    const p = planStatementPipeline({ lines: [line({ id: "b", ai_confidence: 60 })], statement: febStmt, thresholds: th });
    expect(p.toBook).toEqual([]);
    expect(p.exceptions).toHaveLength(1);
    expect(p.exceptions[0]).toMatchObject({ lineId: "b", reason: "low_confidence" });
  });
  it("null confidence (uncategorized) → 'low_confidence'", () => {
    const p = planStatementPipeline({ lines: [line({ id: "c", ai_confidence: null })], statement: febStmt, thresholds: th });
    expect(p.exceptions[0]).toMatchObject({ reason: "low_confidence" });
  });
  it("explicit needs_review → 'low_confidence' even at high confidence", () => {
    const p = planStatementPipeline({ lines: [line({ id: "d", ai_confidence: 99, needs_review: true })], statement: febStmt, thresholds: th });
    expect(p.toBook).toEqual([]);
    expect(p.exceptions[0]).toMatchObject({ reason: "low_confidence" });
  });
  it("exactly at the floor → toBook (>= is inclusive)", () => {
    const p = planStatementPipeline({ lines: [line({ id: "e", ai_confidence: FLOOR })], statement: febStmt, thresholds: th });
    expect(p.toBook.map(l => l.id)).toEqual(["e"]);
  });
  it("defaults the floor to AI_CONFIDENCE_AUTO_BOOK when not passed", () => {
    expect(DEFAULT_AUTO_BOOK_FLOOR).toBe(85);
    const p = planStatementPipeline({ lines: [line({ id: "f", ai_confidence: 84 })], statement: febStmt });
    expect(p.exceptions[0]).toMatchObject({ reason: "low_confidence" });   // 84 < default 85
  });
});

describe("signed-period lines never book — always an exception", () => {
  const signoffs = [{ period: "2026-01", revoked_at: null }];   // January signed off
  it("a confident line dated in a signed month → 'signed_period' exception, not toBook", () => {
    const janLine = line({ id: "g", line_date: "2026-01-28", ai_confidence: 99 });
    const janStmt = { period_start: "2026-01-01", period_end: "2026-01-31" };
    const p = planStatementPipeline({ lines: [janLine], signoffs, statement: janStmt, thresholds: th });
    expect(p.toBook).toEqual([]);
    expect(p.exceptions[0]).toMatchObject({ lineId: "g", reason: "signed_period", period: "2026-01" });
  });
});

describe("already-booked lines are untouched (re-upload dedup)", () => {
  it("status 'already_booked' → alreadyBooked, never toBook, never an exception", () => {
    const p = planStatementPipeline({ lines: [line({ id: "h", status: "already_booked" })], statement: febStmt, thresholds: th });
    expect(p.alreadyBooked.map(l => l.id)).toEqual(["h"]);
    expect(p.toBook).toEqual([]);
    expect(p.exceptions).toEqual([]);
  });
});

describe("reconciliation.attempt gating", () => {
  it("attempt=true for an open, unreconciled month", () => {
    const p = planStatementPipeline({ lines: [line()], statement: febStmt, thresholds: th });
    expect(p.reconciliation).toMatchObject({ attempt: true, reason: "ready" });
  });
  it("attempt=false when the period is already SIGNED OFF", () => {
    const janStmt = { period_start: "2026-01-01", period_end: "2026-01-31" };
    const p = planStatementPipeline({ lines: [], signoffs: [{ period: "2026-01", revoked_at: null }], statement: janStmt, thresholds: th });
    expect(p.reconciliation).toMatchObject({ attempt: false, reason: "period_signed_off" });
  });
  it("attempt=false when a completed reconciliation already covers the period", () => {
    const recs = [{ status: "complete", statement_balance: 20614.40, period_start: "2026-02-01", period_end: "2026-02-28" }];
    const p = planStatementPipeline({ lines: [], reconciliations: recs, statement: febStmt, thresholds: th });
    expect(p.reconciliation).toMatchObject({ attempt: false, reason: "already_reconciled" });
  });
});

describe("the exact Feb-re-upload fixture: all already_booked + signed period → zero actions, conclusion 'already matched'", () => {
  it("no toBook, no exceptions, reconciliation.attempt=false, conclusion='already_matched'", () => {
    const janStmt = { period_start: "2026-01-01", period_end: "2026-01-31" };
    const lines = Array.from({ length: 21 }, (_, i) => line({ id: `x${i}`, line_date: "2026-01-15", status: "already_booked" }));
    const p = planStatementPipeline({ lines, signoffs: [{ period: "2026-01", revoked_at: null }], statement: janStmt, thresholds: th });
    expect(p.toBook).toEqual([]);
    expect(p.exceptions).toEqual([]);
    expect(p.alreadyBooked).toHaveLength(21);
    expect(p.reconciliation).toMatchObject({ attempt: false, conclusion: "already_matched" });
    expect(p.counts).toMatchObject({ total: 21, toBook: 0, exceptions: 0, alreadyBooked: 21 });
  });
  it("NOT 'already_matched' when the attested month still has new exceptions (attempt=false but work remains)", () => {
    const janStmt = { period_start: "2026-01-01", period_end: "2026-01-31" };
    // a new confident line dated in the signed month → signed_period exception → work remains
    const lines = [line({ id: "new", line_date: "2026-01-20", ai_confidence: 99 })];
    const p = planStatementPipeline({ lines, signoffs: [{ period: "2026-01", revoked_at: null }], statement: janStmt, thresholds: th });
    expect(p.reconciliation.conclusion).toBe(null);
    expect(p.exceptions[0]).toMatchObject({ reason: "signed_period" });
  });
});

describe("mixed statement partitions cleanly", () => {
  it("splits confident / low-confidence / already-booked in one pass", () => {
    const lines = [
      line({ id: "ok1", ai_confidence: 95 }),
      line({ id: "ok2", ai_confidence: 88 }),
      line({ id: "low", ai_confidence: 40 }),
      line({ id: "seen", status: "already_booked" }),
    ];
    const p = planStatementPipeline({ lines, statement: febStmt, thresholds: th });
    expect(p.toBook.map(l => l.id).sort()).toEqual(["ok1", "ok2"]);
    expect(p.exceptions.map(e => e.lineId)).toEqual(["low"]);
    expect(p.alreadyBooked.map(l => l.id)).toEqual(["seen"]);
    expect(p.counts).toEqual({ total: 4, toBook: 2, exceptions: 1, alreadyBooked: 1, clearsOutstanding: 0 });
  });
});

describe("C187 — outstanding clears partition BEFORE confidence/signed-period", () => {
  const atlasCand = [{ jeId: "je-atlas", date: "2026-02-26", amount: 275, signed: -275, description: "Atlas" }];

  it("an outstanding-matching line at ai_confidence 40 → clearsOutstanding, NOT a low_confidence exception", () => {
    const marLine = line({ id: "atl", line_date: "2026-03-04", amount: -275, direction: "out", ai_confidence: 40 });
    const marStmt = { period_start: "2026-03-01", period_end: "2026-03-31", stated_ending_balance: 20339.40 };
    const p = planStatementPipeline({ lines: [marLine], outstandingCandidates: atlasCand, statement: marStmt, thresholds: th });
    expect(p.clearsOutstanding).toHaveLength(1);
    expect(p.clearsOutstanding[0].candidate.jeId).toBe("je-atlas");
    expect(p.toBook).toEqual([]);
    expect(p.exceptions).toEqual([]);              // low confidence did NOT make it an exception
    expect(p.stillOutstanding).toEqual([]);
    expect(p.counts.clearsOutstanding).toBe(1);
  });

  it("an outstanding clear is not re-checked against a signed period (nothing books)", () => {
    // even if the clearing line is dated in a signed month, it CLEARS (no booking → no attestation change)
    const janClear = line({ id: "atl", line_date: "2026-01-31", amount: -275, direction: "out", ai_confidence: 99 });
    const cand = [{ jeId: "je-x", date: "2026-01-10", amount: 275, signed: -275 }];
    const stmt = { period_start: "2026-02-01", period_end: "2026-02-28" };
    const p = planStatementPipeline({ lines: [janClear], outstandingCandidates: cand, signoffs: [{ period: "2026-01", revoked_at: null }], statement: stmt, thresholds: th });
    expect(p.clearsOutstanding).toHaveLength(1);
    expect(p.exceptions).toEqual([]);
  });

  it("THE ATLAS FIXTURE end-to-end: Feb outstanding $275 + a March $275 out-line + confident others → clears, does not book, recon attempt proceeds with 0 still-outstanding", () => {
    const marStmt = { period_start: "2026-03-01", period_end: "2026-03-31", stated_ending_balance: 20339.40 };
    const lines = [
      line({ id: "atlas275", line_date: "2026-03-04", amount: -275, direction: "out", ai_confidence: 92 }),   // the clearing debit
      line({ id: "roma", line_date: "2026-03-10", amount: -512.35, direction: "out", ai_confidence: 95 }),     // a fresh confident line
      line({ id: "toast", line_date: "2026-03-12", amount: 900, direction: "in", ai_confidence: 96 }),
    ];
    const p = planStatementPipeline({ lines, outstandingCandidates: atlasCand, statement: marStmt, thresholds: th });
    expect(p.clearsOutstanding.map((c) => c.line.id)).toEqual(["atlas275"]);
    expect(p.toBook.map((l) => l.id).sort()).toEqual(["roma", "toast"]);   // the $275 is NOT in toBook (no duplicate)
    expect(p.stillOutstanding).toEqual([]);                                // the item cleared → chain empty
    expect(p.reconciliation.attempt).toBe(true);
  });

  it("an item that does NOT clear this month stays in stillOutstanding (carries forward)", () => {
    const marStmt = { period_start: "2026-03-01", period_end: "2026-03-31" };
    const p = planStatementPipeline({ lines: [line({ id: "other", amount: -50, ai_confidence: 95 })], outstandingCandidates: atlasCand, statement: marStmt, thresholds: th });
    expect(p.clearsOutstanding).toEqual([]);
    expect(p.stillOutstanding.map((c) => c.jeId)).toEqual(["je-atlas"]);
  });
});
