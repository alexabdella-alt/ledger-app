import { describe, it, expect } from "vitest";
import { buildAccruedLiabilityEntry } from "../src/lib/accruedLiabilities.js";

// Expand the builder's lines to {code, debit, credit} for assertions.
const lines = e => e.lines;
const debitOf = (ls, code) => ls.filter(l => l.code === code).reduce((s, l) => s + l.debit, 0);
const creditOf = (ls, code) => ls.filter(l => l.code === code).reduce((s, l) => s + l.credit, 0);

describe("buildAccruedLiabilityEntry (#10) — Dr Expense / Cr Accrued Liabilities (2100)", () => {
  it("books the exact Dr Expense / Cr Accrued, balanced", () => {
    const e = buildAccruedLiabilityEntry({ amount: 800, expenseCode: "6000", accruedCode: "2100", vendor: "Utilities accrual", date: "2026-06-30" });
    const ls = lines(e);
    expect(debitOf(ls, "6000")).toBe(800);    // Dr Expense (P&L)
    expect(creditOf(ls, "2100")).toBe(800);   // Cr Accrued Liabilities
    expect(debitOf(ls, "2100")).toBe(0);
    expect(creditOf(ls, "6000")).toBe(0);
    expect(e.totalDebit).toBe(e.totalCredit); // balanced
    expect(e.balanced).toBe(true);
    expect(e.source).toBe("gaap_accrued");
    expect(e.date).toBe("2026-06-30");
  });

  it("rounds to cents", () => {
    const e = buildAccruedLiabilityEntry({ amount: 123.456, expenseCode: "6200", accruedCode: "2100" });
    expect(debitOf(lines(e), "6200")).toBe(123.46);
    expect(creditOf(lines(e), "2100")).toBe(123.46);
  });

  it("returns null on invalid inputs (no double-posting a bad accrual)", () => {
    expect(buildAccruedLiabilityEntry({ amount: 0, expenseCode: "6000", accruedCode: "2100" })).toBe(null);
    expect(buildAccruedLiabilityEntry({ amount: -50, expenseCode: "6000", accruedCode: "2100" })).toBe(null);
    expect(buildAccruedLiabilityEntry({ amount: 100, accruedCode: "2100" })).toBe(null);       // no expense code
    expect(buildAccruedLiabilityEntry({ amount: 100, expenseCode: "6000" })).toBe(null);       // no accrued code
    expect(buildAccruedLiabilityEntry()).toBe(null);
  });
});
