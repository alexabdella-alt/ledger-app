import { describe, it, expect } from "vitest";
import {
  bookingToastCopy, statementsCoveredByReconciliation, autoResolvableIntake,
  outstandingCheckCopy, openingMismatchCopy, statementExceptionCopy, STATEMENT_EXCEPTION_COPY,
} from "../src/lib/workbench.js";
import { priorDismissalFor, applyPatternSuppression, openHighAnomaliesInPeriod } from "../src/lib/anomalies.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ════════════════════════════════════════════════════════════════════════════
// C195 — workbench honesty sweep. Every item has a live O84 reproduction.
// ════════════════════════════════════════════════════════════════════════════

describe("(6) truthful booking toast — the live '0 / 0 after booking 5'", () => {
  it("leads with what was RECORDED; no matcher zeros when nothing was matched", () => {
    const msg = bookingToastCopy({ booked: 5, deterministic: 0, llm: 0 });
    expect(msg).toContain("5 transactions recorded");
    expect(msg).not.toMatch(/0/);            // ← the bug: zeros must not lead (or appear at all here)
    expect(msg).toContain("✓");
  });
  it("mentions matching only when matching happened", () => {
    expect(bookingToastCopy({ booked: 3, cleared: 2, deterministic: 2, llm: 0 }))
      .toContain("matched automatically: 2");
    expect(bookingToastCopy({ booked: 3, cleared: 2, deterministic: 2, llm: 1 }))
      .toContain("with AI help: 1");
  });
  it("counts bill payments, payroll and review items distinctly", () => {
    const m = bookingToastCopy({ booked: 4, cleared: 2, payrollMatched: 1, payrollFlagged: 1, needReview: 3 });
    expect(m).toContain("4 transactions recorded");
    expect(m).toContain("2 bill payments matched");
    expect(m).toContain("1 payroll line already covered");
    expect(m).toContain("3 still need a look");
  });
  it("failures are stated and suppress the ✓", () => {
    const m = bookingToastCopy({ booked: 2, failed: 1 });
    expect(m).toContain("1 didn't save");
    expect(m).not.toContain("✓");
  });
  it("nothing to do says so plainly instead of printing zeros", () => {
    const m = bookingToastCopy({});
    expect(m).toMatch(/Nothing new to record/);
    expect(m).not.toMatch(/\b0\b/);
  });
  it("stays jargon-free (owner-facing)", () => {
    for (const args of [{ booked: 5 }, { booked: 1, cleared: 1, needReview: 2 }, {}]) {
      expect(containsOwnerJargon(bookingToastCopy(args))).toBe(false);
    }
  });
});

describe("(2) reconciliation retires the statements it covers", () => {
  const stmt = (over) => ({ id: "s1", bank_account_id: "acc1", period_start: "2026-04-01", period_end: "2026-04-30", status: "attention", ...over });
  const range = { accountId: "acc1", periodStart: "2026-04-01", periodEnd: "2026-04-30" };

  it("retires an attention statement inside the reconciled period (the live stale April card)", () => {
    expect(statementsCoveredByReconciliation([stmt()], range)).toEqual(["s1"]);
  });
  it("KEEPS a statement that still has unresolved excepted lines (real work remains)", () => {
    expect(statementsCoveredByReconciliation([stmt()], { ...range, exceptedStatementIds: ["s1"] })).toEqual([]);
  });
  it("ignores other accounts and periods outside the reconciled range", () => {
    expect(statementsCoveredByReconciliation([stmt({ id: "other", bank_account_id: "acc2" })], range)).toEqual([]);
    expect(statementsCoveredByReconciliation([stmt({ id: "may", period_start: "2026-05-01", period_end: "2026-05-31" })], range)).toEqual([]);
  });
  it("ignores statements that aren't flagged 'attention'", () => {
    expect(statementsCoveredByReconciliation([stmt({ status: "complete" })], range)).toEqual([]);
  });
});

describe("(3) anomaly pattern suppression — alarm fatigue (the Bluebonnet repeat)", () => {
  const now = new Date("2026-05-15T00:00:00Z");
  const dismissed = {
    status: "dismissed", type: "duplicate_payment",
    title: "Possible duplicate payment to Bluebonnet Linen Service",
    detail: "Two charges to Bluebonnet Linen Service for $145.00 within a week — could be a double payment.",
    resolved_at: "2026-04-10T00:00:00Z",   // 35 days ago → inside the 60-day window
  };
  const detected = {
    type: "duplicate_payment", severity: "high", vendor: "Bluebonnet Linen Service", amount: 145,
    title: "Possible duplicate payment to Bluebonnet Linen Service",
    description: "Two charges to Bluebonnet Linen Service for $145.00 within a week — could be a double payment.",
  };

  it("finds the prior dismissal for the same vendor + amount inside the window", () => {
    expect(priorDismissalFor([dismissed], { vendor: "Bluebonnet Linen Service", amount: 145, now })).toBeTruthy();
  });
  it("does NOT match a different amount or a different vendor", () => {
    expect(priorDismissalFor([dismissed], { vendor: "Bluebonnet Linen Service", amount: 200, now })).toBe(null);
    expect(priorDismissalFor([dismissed], { vendor: "Sysco", amount: 145, now })).toBe(null);
  });
  it("does NOT match a dismissal older than the window", () => {
    const old = { ...dismissed, resolved_at: "2026-01-01T00:00:00Z" };   // >60 days
    expect(priorDismissalFor([old], { vendor: "Bluebonnet Linen Service", amount: 145, now })).toBe(null);
  });
  it("only DISMISSED rows suppress — an open/resolved one does not", () => {
    for (const status of ["open", "resolved"]) {
      expect(priorDismissalFor([{ ...dismissed, status }], { vendor: "Bluebonnet Linen Service", amount: 145, now })).toBe(null);
    }
  });
  it("downgrades the re-detection to LOW and explains why", () => {
    const [out] = applyPatternSuppression([detected], [dismissed], { now });
    expect(out.severity).toBe("low");
    expect(out.suppressed).toBe(true);
    expect(out.description).toMatch(/flagged this before/i);
  });
  it("a LOW anomaly does NOT block sign-off (the gate counts HIGH-in-period only)", () => {
    const rows = [{ status: "open", severity: "low", fingerprint: "dup:a-b", entity_refs: ["e1"] }];
    const invoices = [{ id: "e1", date: "2026-05-10" }];
    expect(openHighAnomaliesInPeriod(rows, "2026-05", invoices)).toBe(0);
    // …the same anomaly at HIGH would block
    expect(openHighAnomaliesInPeriod([{ ...rows[0], severity: "high" }], "2026-05", invoices)).toBe(1);
  });
  it("leaves a first-time duplicate at HIGH (no prior dismissal)", () => {
    const [out] = applyPatternSuppression([detected], [], { now });
    expect(out.severity).toBe("high");
    expect(out.suppressed).toBeUndefined();
  });
  it("never touches non-duplicate anomaly types", () => {
    const spike = { type: "vendor_spike", severity: "high", vendor: "X", amount: 1 };
    expect(applyPatternSuppression([spike], [dismissed], { now })[0]).toEqual(spike);
  });
});

describe("(7) intake orphan auto-resolve on content-hash", () => {
  it("resolves a dropped intake row whose hash matches a recorded document (the register-02 nag)", () => {
    const dropped = [{ id: "i1", content_hash: "abc" }, { id: "i2", content_hash: "zzz" }];
    const docs = [{ id: "doc1", content_hash: "abc" }];
    expect(autoResolvableIntake({ droppedRows: dropped, recordedHashes: docs }))
      .toEqual([{ intakeId: "i1", documentId: "doc1" }]);
  });
  it("leaves genuinely-unrecorded intake rows alone (no false clearing)", () => {
    expect(autoResolvableIntake({ droppedRows: [{ id: "i2", content_hash: "zzz" }], recordedHashes: [{ id: "d", content_hash: "abc" }] })).toEqual([]);
    expect(autoResolvableIntake({ droppedRows: [{ id: "i3", content_hash: null }], recordedHashes: [{ id: "d", content_hash: "abc" }] })).toEqual([]);
  });
});

describe("(8) plain-language pass — the 'knows nothing' bar", () => {
  it("outstanding-check copy explains WHAT, WHY, that it's normal, and what happens next", () => {
    const c = outstandingCheckCopy({ amount: 350, date: "2026-04-22" });
    expect(c).toMatch(/\$350\.00/);
    expect(c).toMatch(/nobody has cashed/i);          // what
    expect(c).toMatch(/bank doesn't know about it yet/i);  // why the two numbers differ
    expect(c).toMatch(/normal/i);                      // reassurance
    expect(c).toMatch(/carry it forward/i);            // what happens next
    expect(containsOwnerJargon(c)).toBe(false);
  });
  it("opening mismatch fully explained by known uncashed checks → a ✓, NOT an alarm", () => {
    const c = openingMismatchCopy({ diff: -275, explainedCount: 1, accountName: "Primary Checking" });
    expect(c).toMatch(/explained by 1 check/i);
    expect(c).toContain("✓");
    expect(c).not.toMatch(/⚠|can't yet explain/i);
  });
  it("an UNexplained gap still says so honestly, and says nothing was changed", () => {
    const c = openingMismatchCopy({ diff: 500, explainedCount: 0 });
    expect(c).toMatch(/can't yet explain/i);
    expect(c).toMatch(/Nothing has been changed/i);
    expect(c).not.toContain("✓");
  });
  it("statement-exception copy tells the reader what happens next, jargon-free", () => {
    for (const reason of Object.keys(STATEMENT_EXCEPTION_COPY)) {
      const c = statementExceptionCopy(reason);
      expect(c.length).toBeGreaterThan(20);
      expect(containsOwnerJargon(c)).toBe(false);
      expect(c).toMatch(/accountant|recorded|label|connect|sort out/i);   // always an outcome
    }
    expect(statementExceptionCopy("something_new")).toMatch(/accountant/i);
  });
});
