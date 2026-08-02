import { describe, it, expect } from "vitest";
import {
  priorOutstandingCandidates, matchOutstandingClears, stillOutstandingSigned, candidatesToOutstandingBooks,
} from "../src/lib/outstandingItems.js";

// ════════════════════════════════════════════════════════════════════════════
// C187 — a prior period's uncleared check that appears on THIS statement is that
// entry CLEARING, not new activity. Never book a duplicate.
// ════════════════════════════════════════════════════════════════════════════

const rec = (over = {}) => ({ status: "complete", account_id: "acc1", account_name: "Primary Checking", period_start: "2026-02-01", period_end: "2026-02-28", completed_at: "2026-03-01T00:00:00Z", outstanding_books: [], ...over });
const atlas = { id: "je-atlas", date: "2026-02-26", amount: 275, signed: -275, description: "Atlas Hood & Exhaust" };

describe("priorOutstandingCandidates — the latest prior completed recon for this account", () => {
  it("reads the outstanding_books of the latest prior recon (period_end < periodStart)", () => {
    const recs = [rec({ outstanding_books: [atlas] })];
    const c = priorOutstandingCandidates({ reconciliations: recs, accountId: "acc1", accountName: "Primary Checking", periodStart: "2026-03-01" });
    expect(c).toEqual([{ jeId: "je-atlas", date: "2026-02-26", amount: 275, signed: -275, description: "Atlas Hood & Exhaust" }]);
  });
  it("the LATEST prior recon wins when there are several", () => {
    const recs = [
      rec({ period_end: "2026-01-31", outstanding_books: [{ id: "old", amount: 99, signed: -99, date: "2026-01-10" }] }),
      rec({ period_end: "2026-02-28", outstanding_books: [atlas] }),
    ];
    const c = priorOutstandingCandidates({ reconciliations: recs, accountId: "acc1", periodStart: "2026-03-01" });
    expect(c.map((x) => x.jeId)).toEqual(["je-atlas"]);   // Feb (latest) wins, not Jan
  });
  it("scopes by account_id when present", () => {
    const recs = [rec({ account_id: "other", outstanding_books: [atlas] })];
    expect(priorOutstandingCandidates({ reconciliations: recs, accountId: "acc1", periodStart: "2026-03-01" })).toEqual([]);
  });
  it("scopes by NAME when there is no id (manual account)", () => {
    const recs = [rec({ account_id: null, account_name: "Cash Drawer", outstanding_books: [atlas] })];
    expect(priorOutstandingCandidates({ reconciliations: recs, accountId: "manual", accountName: "Cash Drawer", periodStart: "2026-03-01" }).map((x) => x.jeId)).toEqual(["je-atlas"]);
    expect(priorOutstandingCandidates({ reconciliations: recs, accountId: "manual", accountName: "Other", periodStart: "2026-03-01" })).toEqual([]);
  });
  it("no prior recon → empty", () => {
    expect(priorOutstandingCandidates({ reconciliations: [], accountId: "acc1", periodStart: "2026-03-01" })).toEqual([]);
    // a recon whose period is NOT before the statement start is not a prior
    const recs = [rec({ period_end: "2026-03-31", outstanding_books: [atlas] })];
    expect(priorOutstandingCandidates({ reconciliations: recs, accountId: "acc1", periodStart: "2026-03-01" })).toEqual([]);
  });
  it("ignores non-complete recons", () => {
    const recs = [rec({ status: "open", outstanding_books: [atlas] })];
    expect(priorOutstandingCandidates({ reconciliations: recs, accountId: "acc1", periodStart: "2026-03-01" })).toEqual([]);
  });
});

describe("matchOutstandingClears — exact amount + direction + on/after date; multiset", () => {
  const cand = [{ jeId: "je-atlas", date: "2026-02-26", amount: 275, signed: -275 }];
  it("the Atlas $275 debit on the March statement clears the Feb outstanding item", () => {
    const lines = [{ id: "m1", date: "2026-03-04", amount: -275, type: "expense" }];
    const r = matchOutstandingClears(lines, cand);
    expect(r.clears).toHaveLength(1);
    expect(r.clears[0].candidate.jeId).toBe("je-atlas");
    expect(r.remainingLines).toEqual([]);
    expect(r.stillOutstanding).toEqual([]);
  });
  it("EXACT amount only — 274.99 does NOT clear 275.00", () => {
    const r = matchOutstandingClears([{ id: "m", date: "2026-03-04", amount: -274.99, type: "expense" }], cand);
    expect(r.clears).toEqual([]);
    expect(r.stillOutstanding).toHaveLength(1);
  });
  it("direction must agree — a $275 DEPOSIT does not clear an outstanding CHECK", () => {
    const r = matchOutstandingClears([{ id: "m", date: "2026-03-04", amount: 275, type: "revenue" }], cand);
    expect(r.clears).toEqual([]);
  });
  it("a line dated BEFORE the item's date does not clear it", () => {
    const r = matchOutstandingClears([{ id: "m", date: "2026-02-20", amount: -275, type: "expense" }], cand);
    expect(r.clears).toEqual([]);
  });
  it("MULTISET — two $150 outstanding checks + one $150 line → one clears, one stays outstanding", () => {
    const two = [
      { jeId: "j1", date: "2026-02-10", amount: 150, signed: -150 },
      { jeId: "j2", date: "2026-02-12", amount: 150, signed: -150 },
    ];
    const r = matchOutstandingClears([{ id: "m", date: "2026-03-05", amount: -150, type: "expense" }], two);
    expect(r.clears).toHaveLength(1);
    expect(r.stillOutstanding).toHaveLength(1);   // the second $150 remains
  });
});

describe("chain helpers", () => {
  it("stillOutstandingSigned sums the signed amounts", () => {
    expect(stillOutstandingSigned([{ signed: -275 }, { signed: -150 }])).toBe(-425);
    expect(stillOutstandingSigned([])).toBe(0);
  });
  it("candidatesToOutstandingBooks maps back to the stored jsonb shape", () => {
    expect(candidatesToOutstandingBooks([{ jeId: "je-atlas", date: "2026-02-26", amount: 275, signed: -275, description: "Atlas" }]))
      .toEqual([{ id: "je-atlas", date: "2026-02-26", amount: 275, signed: -275, description: "Atlas" }]);
  });
});
