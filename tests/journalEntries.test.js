import { describe, it, expect } from "vitest";
import { buildReversalLines, reverseEntryLines, buildJournalEntry } from "../src/lib/journalEntries.js";

const sumD = ls => ls.reduce((s, l) => s + (l.debit || 0), 0);
const sumC = ls => ls.reduce((s, l) => s + (l.credit || 0), 0);

describe("buildJournalEntry — canonical multi-line entry (Phase 0 foundation)", () => {
  it("builds a balanced 2-line entry (deferred-rev recognition Dr 2300 / Cr 4000)", () => {
    const je = buildJournalEntry({
      lines: [{ code: "2300", debit: 500, credit: 0 }, { code: "4000", debit: 0, credit: 500 }],
      date: "2026-03-01", description: "Revenue recognition", source: "contract",
    });
    expect(je.balanced).toBe(true);
    expect(je.totalDebit).toBe(500);
    expect(je.totalCredit).toBe(500);
    expect(je.lines).toHaveLength(2);
  });

  it("handles N>2 lines (lease commencement: Dr ROU / Cr current / Cr LT)", () => {
    const je = buildJournalEntry({
      lines: [
        { code: "1800", debit: 10000, credit: 0 },
        { code: "2400", debit: 0, credit: 4000 },
        { code: "2450", debit: 0, credit: 6000 },
      ],
    });
    expect(je.balanced).toBe(true);
    expect(je.lines).toHaveLength(3);
    expect(je.totalDebit).toBe(10000);
  });

  it("accepts account_code-keyed lines (contract shape) and drops zero lines", () => {
    const je = buildJournalEntry({
      lines: [
        { account_code: "6500", account_name: "Tech", debit: 250, credit: 0 },
        { account_code: "1400", account_name: "Prepaid", debit: 0, credit: 250 },
        { account_code: "9999", debit: 0, credit: 0 },   // zero → dropped
      ],
    });
    expect(je.lines.map(l => l.code)).toEqual(["6500", "1400"]);
    expect(je.balanced).toBe(true);
  });

  it("flags an unbalanced entry as NOT balanced (so the persist path refuses it)", () => {
    const je = buildJournalEntry({ lines: [{ code: "6500", debit: 100, credit: 0 }, { code: "1000", debit: 0, credit: 90 }] });
    expect(je.balanced).toBe(false);
    expect(je.totalDebit).toBe(100);
    expect(je.totalCredit).toBe(90);
  });

  it("a single non-zero line is not a valid (balanced) entry", () => {
    expect(buildJournalEntry({ lines: [{ code: "6500", debit: 100, credit: 0 }] }).balanced).toBe(false);
  });

  it("rounds to cents (no floating-point imbalance)", () => {
    const je = buildJournalEntry({ lines: [{ code: "6500", debit: 0.1 + 0.2, credit: 0 }, { code: "1000", debit: 0, credit: 0.3 }] });
    expect(je.totalDebit).toBe(0.3);
    expect(je.balanced).toBe(true);
  });
});

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
