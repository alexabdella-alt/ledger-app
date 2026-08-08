import { describe, it, expect } from "vitest";
import {
  outstandingClearedCopy, MATCH_EXISTING_ACTION_LABEL,
  statementSummaryCopy, firstUnsignedMonth, openingMismatchCopy,
} from "../src/lib/workbench.js";
import { priorOutstandingCandidates, matchOutstandingClears } from "../src/lib/outstandingItems.js";
import { runAnomalyDetection, isSystemPostedEntry } from "../src/lib/insights.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ════════════════════════════════════════════════════════════════════════════
// C196 — trust-surface fixes from the May drive (O85). The suggester must never
// invite a wrong click, and every counter must tell the truth.
// ════════════════════════════════════════════════════════════════════════════

describe("★ (1) the sort-out list must consult the outstanding chain", () => {
  // THE live failure: Reconcile offered "Accept & add" for a bank line that was a prior
  // period's outstanding check CLEARING. One click on that suggestion created the program's
  // first wrong ledger entry (a duplicate expense).
  const priorRecon = {
    status: "complete", account_id: "acc1", account_name: "Primary Checking",
    period_start: "2026-04-01", period_end: "2026-04-30", completed_at: "2026-05-01T00:00:00Z",
    outstanding_books: [{ id: "je-1043", date: "2026-04-22", amount: 350, signed: -350, description: "Check #1043" }],
  };
  const scope = { accountId: "acc1", accountName: "Primary Checking", periodStart: "2026-05-01" };
  // The May statement line that IS that check clearing.
  const clearingLine = { id: "b1", date: "2026-05-04", amount: -350, description: "CHECK 1043" };
  // A genuinely new charge nobody has seen.
  const unknownLine = { id: "b2", date: "2026-05-06", amount: -128.40, description: "NEW VENDOR CO" };

  it("a sort-out line matching an outstanding candidate is recognized as a CLEAR (→ match, not add)", () => {
    const cands = priorOutstandingCandidates({ reconciliations: [priorRecon], ...scope });
    expect(cands).toHaveLength(1);
    const { clears } = matchOutstandingClears([clearingLine], cands);
    expect(clears).toHaveLength(1);
    expect(clears[0].candidate.jeId).toBe("je-1043");
    expect(clears[0].line.id).toBe("b1");
  });

  it("a genuinely unknown line yields NO clear — accept-&-add remains correct for it", () => {
    const cands = priorOutstandingCandidates({ reconciliations: [priorRecon], ...scope });
    const { clears, remainingLines } = matchOutstandingClears([unknownLine], cands);
    expect(clears).toEqual([]);
    expect(remainingLines.map(l => l.id)).toEqual(["b2"]);
  });

  it("a MIXED statement splits correctly: the check matches, the new charge stays addable", () => {
    const cands = priorOutstandingCandidates({ reconciliations: [priorRecon], ...scope });
    const { clears, remainingLines } = matchOutstandingClears([clearingLine, unknownLine], cands);
    expect(clears.map(c => c.line.id)).toEqual(["b1"]);       // explained → match action
    expect(remainingLines.map(l => l.id)).toEqual(["b2"]);    // unexplained → accept & add
  });

  it("the explanation reads as an explanation, not a task — and is jargon-free", () => {
    const c = outstandingClearedCopy({ date: "2026-04-22", amount: 350 });
    expect(c).toMatch(/\$350\.00/);
    expect(c).toMatch(/check you wrote/i);
    expect(c).toMatch(/just cleared ✓/);
    expect(containsOwnerJargon(c)).toBe(false);
    expect(MATCH_EXISTING_ACTION_LABEL).toBe("Match to your existing entry");
    expect(containsOwnerJargon(MATCH_EXISTING_ACTION_LABEL)).toBe(false);
  });

  it("with NO prior reconciliation there are no candidates — behaviour is unchanged", () => {
    expect(priorOutstandingCandidates({ reconciliations: [], ...scope })).toEqual([]);
    expect(matchOutstandingClears([clearingLine], []).clears).toEqual([]);
  });
});

describe("(2) the opening banner may only warn about what we cannot explain", () => {
  it("a chain-explained gap renders the calm ✓ line (no alarm)", () => {
    const c = openingMismatchCopy({ diff: -350, explainedCount: 1, accountName: "Primary Checking" });
    expect(c).toMatch(/explained by 1 check/i);
    expect(c).toContain("✓");
    expect(c).not.toMatch(/⚠/);
  });
  it("an unexplained gap keeps the honest warning and says nothing changed", () => {
    const c = openingMismatchCopy({ diff: 900, explainedCount: 0, accountName: "Primary Checking" });
    expect(c).toMatch(/can't yet explain/i);
    expect(c).toMatch(/Nothing has been changed/i);
    expect(c).not.toContain("✓");
  });
});

describe("(3) whole-statement counters, not the residue", () => {
  it("the live shape: 21 lines, 16 handled, 5 needing input", () => {
    expect(statementSummaryCopy({ total: 21, handled: 16, needInput: 5 }))
      .toBe("21 transactions · 16 handled automatically · 5 need your input");
  });
  it("a fully-handled statement says so — never '0 need your input'", () => {
    const c = statementSummaryCopy({ total: 21, handled: 21, needInput: 0 });
    expect(c).toContain("21 transactions · 21 handled automatically");
    expect(c).toContain("nothing needs your input ✓");
    expect(c).not.toMatch(/\b0 need/);
  });
  it("singular is grammatical — one item never reads '1 need your input'", () => {
    expect(statementSummaryCopy({ total: 3, handled: 2, needInput: 1 })).toContain("1 needs your input");
  });
  it("empty statement doesn't print zeros", () => {
    expect(statementSummaryCopy({ total: 0 })).toBe("No transactions on this statement");
  });
  it("stays jargon-free", () => {
    expect(containsOwnerJargon(statementSummaryCopy({ total: 21, handled: 16, needInput: 5 }))).toBe(false);
  });
});

describe("(4) noise detectors exempt payroll / system-posted entries", () => {
  const NOW = new Date("2026-05-20T12:00:00Z");
  const payrollGross = { id: "p1", vendor: "Gusto Payroll", amount: 4000, date: "2026-05-15", gl_code: "6000", status: "posted", source: "payroll" };
  const realEquipment = { id: "e1", vendor: "Restaurant Depot", amount: 4000, date: "2026-05-15", gl_code: "6600", status: "posted", source: "universal_upload" };

  it("isSystemPostedEntry recognizes payroll + system sources and meta kinds", () => {
    expect(isSystemPostedEntry({ source: "payroll" })).toBe(true);
    expect(isSystemPostedEntry({ source: "opening_balance" })).toBe(true);
    expect(isSystemPostedEntry({ import_metadata: { kind: "ap_payment" } })).toBe(true);
    expect(isSystemPostedEntry({ source: "universal_upload" })).toBe(false);
    expect(isSystemPostedEntry({})).toBe(false);
  });

  it("a $4,000 payroll gross is NOT flagged as large-charge or round-amount (the live nonsense)", () => {
    const found = runAnomalyDetection([payrollGross], [], NOW);
    expect(found.filter(a => a.type === "large_transaction")).toHaveLength(0);
    expect(found.filter(a => a.type === "round_number")).toHaveLength(0);
  });

  it("a genuine $4,000 discretionary charge IS still flagged (no over-suppression)", () => {
    const found = runAnomalyDetection([realEquipment], [], NOW);
    expect(found.filter(a => a.type === "large_transaction")).toHaveLength(1);
    expect(found.filter(a => a.type === "round_number")).toHaveLength(1);
  });
});

describe("(6) Review opens on the first UNSIGNED month, not the calendar month", () => {
  const months = ["2026-03", "2026-04", "2026-05"];
  it("returns the earliest month with activity that isn't signed off", () => {
    const signoffs = [{ period: "2026-03", revoked_at: null }];
    expect(firstUnsignedMonth({ months, signoffs, fallback: "2026-08" })).toBe("2026-04");
  });
  it("skips every signed month (the live 'opens on August' bug is the fallback, not the default)", () => {
    const signoffs = ["2026-03", "2026-04"].map(p => ({ period: p, revoked_at: null }));
    expect(firstUnsignedMonth({ months, signoffs, fallback: "2026-08" })).toBe("2026-05");
  });
  it("a REVOKED sign-off means the month is unsigned again", () => {
    const signoffs = [{ period: "2026-03", revoked_at: "2026-05-01T00:00:00Z" }];
    expect(firstUnsignedMonth({ months, signoffs, fallback: "2026-08" })).toBe("2026-03");
  });
  it("every month with activity signed → the month AFTER the latest sign-off, not the calendar month", () => {
    // C198·3b(c) — was the fallback (August). A month nobody attested is the month
    // to review, whether or not anything was booked in it.
    const signoffs = months.map(p => ({ period: p, revoked_at: null }));
    expect(firstUnsignedMonth({ months, signoffs, fallback: "2026-08" })).toBe("2026-06");
  });
  it("no activity at all → the fallback", () => {
    expect(firstUnsignedMonth({ months: [], signoffs: [], fallback: "2026-08" })).toBe("2026-08");
  });
});

// ── C198·3b (c) — THE RULE IS CALENDAR, NOT ACTIVITY ─────────────────────────
// Live O86: June signed off, and the picker opened on AUGUST because July had
// nothing booked in it. A quiet month is still a month someone has to attest.
describe("(c) the next month to review is the month AFTER the latest sign-off, independent of activity", () => {
  it("THE LIVE REPRO — zero-activity July is the default once June is signed", () => {
    expect(firstUnsignedMonth({
      months: ["2026-05", "2026-06"],                       // July has nothing booked
      signoffs: [{ period: "2026-05" }, { period: "2026-06" }].map(s => ({ ...s, revoked_at: null })),
      fallback: "2026-08",
    })).toBe("2026-07");
  });

  it("a GAP in sign-offs lands on the gap rather than stepping over it", () => {
    expect(firstUnsignedMonth({
      months: ["2026-03", "2026-05"],
      signoffs: [{ period: "2026-03", revoked_at: null }, { period: "2026-05", revoked_at: null }],
      fallback: "2026-08",
    })).toBe("2026-04");
  });

  it("crosses a year boundary", () => {
    expect(firstUnsignedMonth({
      months: ["2026-12"],
      signoffs: [{ period: "2026-12", revoked_at: null }],
      fallback: "2027-03",
    })).toBe("2027-01");
  });

  it("never runs past the caller's current month — nothing to review means stay put", () => {
    expect(firstUnsignedMonth({
      months: ["2026-08"],
      signoffs: [{ period: "2026-08", revoked_at: null }],
      fallback: "2026-08",
    })).toBe("2026-08");
  });

  it("nothing signed at all → the start of the books, not the calendar month", () => {
    expect(firstUnsignedMonth({ months: ["2026-04", "2026-05"], signoffs: [], fallback: "2026-08" })).toBe("2026-04");
  });
});
