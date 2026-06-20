import { describe, it, expect } from "vitest";
import { buildDeferredRevenueReceiptEntry } from "../src/lib/revenueEntries.js";

const CASH = "1000", DEF = "2300";
const sumD = ls => ls.reduce((s, l) => s + (l.debit || 0), 0);
const sumC = ls => ls.reduce((s, l) => s + (l.credit || 0), 0);

describe("buildDeferredRevenueReceiptEntry (#11) — Dr Cash / Cr Deferred Revenue", () => {
  it("books a balanced advance receipt", () => {
    const je = buildDeferredRevenueReceiptEntry({ amount: 1200, cashCode: CASH, deferredRevCode: DEF, date: "2026-06-01", vendor: "Acme" });
    expect(je.balanced).toBe(true);
    expect(je.description).toBe("Advance payment – Acme");
    expect(je.lines).toEqual([
      { code: CASH, name: null, debit: 1200, credit: 0, memo: null },
      { code: DEF, name: null, debit: 0, credit: 1200, memo: null },
    ]);
    expect(sumD(je.lines)).toBe(sumC(je.lines));
  });

  it("is a balance-sheet-only movement (no P&L line → net income unaffected)", () => {
    const je = buildDeferredRevenueReceiptEntry({ amount: 500, cashCode: CASH, deferredRevCode: DEF });
    const pl = c => ["4", "5", "6", "7", "8"].includes(String(c)[0]);
    expect(je.lines.some(l => pl(l.code))).toBe(false);   // cash (1xxx) + deferred rev (2xxx) only
  });

  it("rounds to cents", () => {
    const je = buildDeferredRevenueReceiptEntry({ amount: 0.1 + 0.2, cashCode: CASH, deferredRevCode: DEF });
    expect(je.totalDebit).toBe(0.3);
    expect(je.balanced).toBe(true);
  });

  it("returns null on invalid amount or missing accounts", () => {
    expect(buildDeferredRevenueReceiptEntry({ amount: 0, cashCode: CASH, deferredRevCode: DEF })).toBe(null);
    expect(buildDeferredRevenueReceiptEntry({ amount: 100, cashCode: CASH })).toBe(null);
    expect(buildDeferredRevenueReceiptEntry({ amount: 100, deferredRevCode: DEF })).toBe(null);
  });
});
