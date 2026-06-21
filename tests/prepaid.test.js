import { describe, it, expect } from "vitest";
import { buildPrepaidCapitalizeEntry, buildPrepaidAmortizeEntry, buildPrepaidSchedule } from "../src/lib/prepaid.js";

const PREPAID = "1300", AP = "2000", CASH = "1000", INS = "6700";
const sumD = ls => ls.reduce((s, l) => s + (l.debit || 0), 0);
const sumC = ls => ls.reduce((s, l) => s + (l.credit || 0), 0);

describe("buildPrepaidCapitalizeEntry (#9) — Dr Prepaid / Cr offset", () => {
  it("capitalizes to A/P", () => {
    const je = buildPrepaidCapitalizeEntry({ amount: 1200, prepaidCode: PREPAID, offsetCode: AP, date: "2026-01-01", vendor: "Acme Ins" });
    expect(je.balanced).toBe(true);
    expect(je.lines).toEqual([
      { code: PREPAID, name: null, debit: 1200, credit: 0, memo: null },
      { code: AP, name: null, debit: 0, credit: 1200, memo: null },
    ]);
  });
  it("capitalizes to Cash when offset is cash; balance-sheet-only (no NI move)", () => {
    const je = buildPrepaidCapitalizeEntry({ amount: 600, prepaidCode: PREPAID, offsetCode: CASH });
    expect(je.lines[1].code).toBe(CASH);
    const pl = c => ["4", "5", "6", "7", "8"].includes(String(c)[0]);
    expect(je.lines.some(l => pl(l.code))).toBe(false);   // 1300 + cash/ap only
  });
  it("returns null on invalid amount / missing accounts", () => {
    expect(buildPrepaidCapitalizeEntry({ amount: 0, prepaidCode: PREPAID, offsetCode: AP })).toBe(null);
    expect(buildPrepaidCapitalizeEntry({ amount: 100, prepaidCode: PREPAID })).toBe(null);
  });
});

describe("buildPrepaidAmortizeEntry (#9b) — Dr Expense / Cr Prepaid", () => {
  it("recognizes one period's expense", () => {
    const je = buildPrepaidAmortizeEntry({ amount: 100, expenseCode: INS, prepaidCode: PREPAID, date: "2026-02-01" });
    expect(je.lines).toEqual([
      { code: INS, name: null, debit: 100, credit: 0, memo: null },     // Dr expense
      { code: PREPAID, name: null, debit: 0, credit: 100, memo: null }, // Cr prepaid
    ]);
    expect(je.balanced).toBe(true);
  });
  it("returns null on invalid inputs", () => {
    expect(buildPrepaidAmortizeEntry({ amount: 0, expenseCode: INS, prepaidCode: PREPAID })).toBe(null);
    expect(buildPrepaidAmortizeEntry({ amount: 50, expenseCode: INS })).toBe(null);
  });
});

describe("buildPrepaidSchedule — monthly amortization, sums to the capitalized amount", () => {
  it("12 even months of $100", () => {
    const s = buildPrepaidSchedule({ total: 1200, months: 12, startDate: "2026-01-15", expenseCode: INS, prepaidCode: PREPAID });
    expect(s.months).toBe(12);
    expect(s.entries).toHaveLength(12);
    expect(s.monthly).toBe(100);
    expect(s.entries.every(je => je.balanced && je.lines[0].code === INS && je.lines[1].code === PREPAID)).toBe(true);
    expect(s.total).toBe(1200);
  });
  it("last month absorbs the rounding remainder (Σ === total exactly)", () => {
    // $1,000 / 7 = 142.857… → 142.86 ×6 + 142.84 = 1000.00
    const s = buildPrepaidSchedule({ total: 1000, months: 7, startDate: "2026-01-01", expenseCode: INS, prepaidCode: PREPAID });
    const amts = s.entries.map(je => je.lines[0].debit);
    expect(amts.slice(0, 6)).toEqual([142.86, 142.86, 142.86, 142.86, 142.86, 142.86]);
    expect(amts[6]).toBe(142.84);
    expect(Math.round(amts.reduce((a, b) => a + b, 0) * 100) / 100).toBe(1000);   // no stranded residual in 1300
    expect(s.total).toBe(1000);
  });
  it("steps the date one month at a time from the start", () => {
    const s = buildPrepaidSchedule({ total: 1200, months: 12, startDate: "2026-01-15", expenseCode: INS, prepaidCode: PREPAID });
    expect(s.entries[0].date).toBe("2026-01-15");
    expect(s.entries[1].date).toBe("2026-02-15");
    expect(s.entries[11].date).toBe("2026-12-15");
  });
  it("degenerate inputs → empty schedule", () => {
    expect(buildPrepaidSchedule({ total: 1200, months: 0, startDate: "2026-01-01", expenseCode: INS, prepaidCode: PREPAID }).entries).toEqual([]);
    expect(buildPrepaidSchedule({ total: 0, months: 12, startDate: "2026-01-01", expenseCode: INS, prepaidCode: PREPAID }).entries).toEqual([]);
    expect(buildPrepaidSchedule({ total: 1200, months: 12, expenseCode: INS, prepaidCode: PREPAID }).entries).toEqual([]);
  });
});
