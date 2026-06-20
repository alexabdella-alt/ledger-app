import { describe, it, expect } from "vitest";
import { buildReversalLines, reverseEntryLines } from "../src/lib/journalEntries.js";

const sumD = ls => ls.reduce((s, l) => s + (l.debit || 0), 0);
const sumC = ls => ls.reduce((s, l) => s + (l.credit || 0), 0);

describe("buildReversalLines — mirrors each line, stays balanced", () => {
  it("reverses a simple 2-line bill (Dr Expense / Cr AP → Dr AP / Cr Expense)", () => {
    const orig = [
      { account_id: "exp", debit: 100, credit: 0, memo: "AWS" },
      { account_id: "ap", debit: 0, credit: 100, memo: "AWS" },
    ];
    expect(buildReversalLines(orig)).toEqual([
      { account_id: "exp", debit: 0, credit: 100, memo: "AWS" },
      { account_id: "ap", debit: 100, credit: 0, memo: "AWS" },
    ]);
  });

  it("reverses a multi-line entry (payroll) and remains balanced", () => {
    const orig = [
      { account_id: "wages", debit: 1000, credit: 0 },
      { account_id: "ptax", debit: 76.5, credit: 0 },
      { account_id: "cash", debit: 0, credit: 800 },
      { account_id: "accrued", debit: 0, credit: 276.5 },
    ];
    const rev = buildReversalLines(orig);
    expect(sumD(rev)).toBe(sumC(rev));                 // balanced
    expect(sumD(rev)).toBe(sumD(orig));                // same magnitude
    // original + reversal nets to zero on every account
    const net = {};
    [...orig, ...rev].forEach(l => { net[l.account_id] = (net[l.account_id] || 0) + (l.debit || 0) - (l.credit || 0); });
    expect(Object.values(net).every(v => v === 0)).toBe(true);
  });

  it("drops zero-amount lines", () => {
    expect(buildReversalLines([{ account_id: "x", debit: 0, credit: 0 }])).toEqual([]);
  });

  it("regression: NOT a double-negation — reversing once changes the entry (swap+flip would no-op)", () => {
    const orig = [{ account_id: "a", debit: 50, credit: 0, memo: null }, { account_id: "b", debit: 0, credit: 50, memo: null }];
    const rev = buildReversalLines(orig);
    expect(rev).not.toEqual(orig);                     // the old swap-and-flip produced an identical entry
    // applying the reversal transform twice returns the original (involution)
    expect(buildReversalLines(rev)).toEqual(orig);
  });

  it("reverseEntryLines preserves the {code,...} shape", () => {
    expect(reverseEntryLines([{ code: "6500", debit: 100, credit: 0 }])).toEqual([{ code: "6500", debit: 0, credit: 100 }]);
  });
});
