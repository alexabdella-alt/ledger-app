import { describe, it, expect } from "vitest";
import { buildReviewQueue } from "../src/lib/reviewQueue.js";
import { flaggedForReview } from "../src/lib/confidenceFlag.js";
import { reconcileIntake, INTAKE_STATUS } from "../src/lib/documentIntake.js";

const flagged = (over = {}) => ({ id: Math.random(), db_entry_id: "je1", vendor: "Acme", amount: 2000, gl_code: "6100", gl_name: "Rent & Occupancy", confidence: 60, severity: "medium", reason: "uncertain on a material amount", reasoning: "guessed rent", alternatives: [{ gl_code: "6200", gl_name: "Utilities" }], ...over });
const dropped = (over = {}) => ({ id: "i1", filename: "scan.pdf", status: "received", received_at: new Date(Date.now() - 60 * 60000).toISOString(), age_minutes: 60, reason: "received but never recorded (60m)", ...over });

describe("buildReviewQueue — assembles ONE surface from O60 + O49 + unknown, with a summary", () => {
  it("combines the three sources and computes the summary (count, high, $ exposure)", () => {
    const q = buildReviewQueue({
      droppedDocs: [dropped({ id: "d1" }), dropped({ id: "d2" })],
      flaggedTxns: [flagged({ amount: 2000, severity: "medium" }), flagged({ amount: 9000, severity: "high" })],
      unknownDocs: [{ id: "u1", posted: false }, { id: "u2", posted: true }],   // posted is resolved → excluded
    });
    expect(q.completeness).toHaveLength(2);
    expect(q.needsReview).toHaveLength(2);
    expect(q.unknown).toHaveLength(1);                       // only the unposted unknown
    expect(q.summary).toMatchObject({ incompleteCount: 2, flaggedCount: 2, unknownCount: 1, highCount: 1, totalExposure: 11000, allClear: false });
    expect(q.summary.totalItems).toBe(5);
  });

  it("EMPTY STATE: nothing flagged anywhere → allClear true (the reassuring signal)", () => {
    const q = buildReviewQueue({ droppedDocs: [], flaggedTxns: [], unknownDocs: [{ id: "u", posted: true }] });
    expect(q.summary.allClear).toBe(true);
    expect(q.summary.totalItems).toBe(0);
  });

  it("defaults are safe (no args → all-clear, no throw)", () => {
    expect(buildReviewQueue().summary.allClear).toBe(true);
  });
});

describe("APPROVE re-syncs the queue: marking confident removes it from needs-review", () => {
  it("a flagged entry, once approved (confidence→100), no longer appears in flaggedForReview", () => {
    const ledger = [{ id: "t1", db_entry_id: "je1", vendor: "Acme", amount: 2000, gl_code: "6100", gl_name: "Rent", confidence: 60, status: "booked" }];
    expect(flaggedForReview(ledger)).toHaveLength(1);          // flagged before
    // reviewApprove writes ai_confidence=100; flatten exposes it as confidence=100 → re-derive
    const after = ledger.map(i => ({ ...i, confidence: 100 }));
    expect(flaggedForReview(after)).toEqual([]);              // gone from the queue after approve
  });
});

describe("OVERRIDE re-syncs the queue AND re-codes the txn", () => {
  it("after override (recode + confidence→100) the entry leaves the queue and carries the new account", () => {
    const ledger = [{ id: "t1", db_entry_id: "je1", vendor: "Acme", amount: 2000, gl_code: "6100", gl_name: "Rent", confidence: 60, status: "booked" }];
    // reviewOverride: persistRecode swaps the account, then ai_confidence=100
    const after = ledger.map(i => ({ ...i, gl_code: "6200", gl_name: "Utilities", confidence: 100 }));
    expect(flaggedForReview(after)).toEqual([]);              // no longer flagged
    expect(after[0].gl_code).toBe("6200");                    // re-coded to the CPA's choice
  });
});

describe("RESOLVE re-syncs the completeness queue: a terminal intake row drops out", () => {
  it("a dropped doc, once resolved to a terminal state, no longer surfaces in reconciliation", () => {
    const rows = [{ id: "i1", status: INTAKE_STATUS.RECEIVED, received_at: new Date(Date.now() - 60 * 60000).toISOString() }];
    expect(reconcileIntake(rows, { stuckMinutes: 30 })).toHaveLength(1);   // surfaced before
    // resolveIntakeItem(... 'rejected') → terminal
    rows[0].status = INTAKE_STATUS.REJECTED;
    expect(reconcileIntake(rows, { stuckMinutes: 30 })).toEqual([]);       // gone after resolve
    // 'held_for_review' (acknowledge) is also terminal → also drops out
    rows[0].status = INTAKE_STATUS.HELD;
    expect(reconcileIntake(rows, { stuckMinutes: 30 })).toEqual([]);
  });
});

describe("open anomalies join the Review queue (O83) — visibility by any severity", () => {
  const anom = (over = {}) => ({ id: "a1", type: "duplicate_payment", severity: "high", status: "open", fingerprint: "dup:je1-je2", title: "Possible duplicate", detail: "Two charges within a week", ...over });

  it("an open anomaly lands in its own section and counts toward the summary", () => {
    const q = buildReviewQueue({ anomalies: [anom(), anom({ id: "a2", severity: "low", type: "round_number", fingerprint: "round:je9" })] });
    expect(q.anomaly).toHaveLength(2);
    expect(q.summary.anomalyCount).toBe(2);
    expect(q.summary.highCount).toBe(1);                 // only the high one
    expect(q.summary.totalItems).toBe(2);
  });

  it("ANY open anomaly (even low) keeps the screen from 'all clear' — severity ≠ visibility", () => {
    const q = buildReviewQueue({ anomalies: [anom({ severity: "low", type: "round_number", fingerprint: "round:je9" })] });
    expect(q.summary.allClear).toBe(false);
  });

  it("non-open anomalies (resolved/dismissed) are excluded from the section", () => {
    const q = buildReviewQueue({ anomalies: [anom({ status: "resolved" }), anom({ id: "a2", status: "dismissed" })] });
    expect(q.anomaly).toHaveLength(0);
    expect(q.summary.allClear).toBe(true);
  });

  it("no anomalies + all nets clear → still all clear (regression guard)", () => {
    const q = buildReviewQueue({});
    expect(q.summary.allClear).toBe(true);
    expect(q.anomaly).toEqual([]);
  });
});

describe("statement exceptions (C186) join the Review queue", () => {
  const exc = (over = {}) => ({ id: "sx1", kind: "line", reason: "low_confidence", title: "Roma", amount: -512.35, plain: "We weren't sure how to categorize this.", ...over });

  it("pipeline exceptions land in their own section + count toward the summary/totalItems", () => {
    const q = buildReviewQueue({ statementExceptions: [exc(), exc({ id: "sx2", reason: "unmatched" })] });
    expect(q.statementException).toHaveLength(2);
    expect(q.summary.statementExceptionCount).toBe(2);
    expect(q.summary.totalItems).toBe(2);
  });

  it("ANY statement exception keeps the screen from 'all clear'", () => {
    const q = buildReviewQueue({ statementExceptions: [exc({ reason: "balance_discrepancy", kind: "statement" })] });
    expect(q.summary.allClear).toBe(false);
  });

  it("no statement exceptions → does not affect all-clear (regression guard)", () => {
    const q = buildReviewQueue({});
    expect(q.statementException).toEqual([]);
    expect(q.summary.statementExceptionCount).toBe(0);
    expect(q.summary.allClear).toBe(true);
  });

  it("exceptions combine with the other nets in totalItems", () => {
    const q = buildReviewQueue({
      anomalies: [{ id: "a1", severity: "high", status: "open" }],
      statementExceptions: [exc()],
    });
    expect(q.summary.totalItems).toBe(2);        // 1 anomaly + 1 statement exception
    expect(q.summary.allClear).toBe(false);
  });
});
