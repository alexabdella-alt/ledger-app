import { describe, it, expect } from "vitest";
import { nextWaitingDeadline, estimateTaxYearFor, getTaxDeadlines } from "../src/lib/tax";

// C618 — review finding R7: January 1–15.
const jan5 = new Date(2027, 0, 5, 12);

describe("the Q4 payment is sized from the year it is about", () => {
  it("★ the January 15 estimate is about LAST year; others about their own", () => {
    const ds = getTaxDeadlines(jan5);
    const q4 = ds.find((d) => d.m === 0 && d.d === 15);
    expect(q4.year).toBe(2027);
    expect(estimateTaxYearFor(q4)).toBe(2026);
    const q2 = ds.find((d) => d.m === 5 && d.d === 15);
    expect(estimateTaxYearFor(q2)).toBe(q2.year);
  });

  it("★ the estimate is asked for that year", () => {
    const asked = [];
    nextWaitingDeadline(jan5, 30, { estimateFor: (y) => { asked.push(y); return { total: 1200, quarterly: 300 }; } });
    expect(asked[0]).toBe(2026);
  });
});

describe("a deadline with nothing to do does not hide the next one", () => {
  it("★ Q4 with nothing owed → the January 31 1099 deadline is shown", () => {
    const w = nextWaitingDeadline(jan5, 30, { estimateFor: () => ({ total: 0, quarterly: 0 }), has1099sFor: () => true });
    expect(w.deadline.kind).toBe("1099");
    expect(w.deadline.d).toBe(31);
  });

  it("Q4 with something owed comes first, with its estimate", () => {
    const w = nextWaitingDeadline(jan5, 30, { estimateFor: () => ({ total: 1200, quarterly: 300 }), has1099sFor: () => true });
    expect([w.deadline.m, w.deadline.d, w.estimate.quarterly]).toEqual([0, 15, 300]);
  });

  it("nothing to pay and nobody to file for → nothing", () => {
    expect(nextWaitingDeadline(jan5, 30, { estimateFor: () => ({ total: 0 }), has1099sFor: () => false })).toBeNull();
  });
});
