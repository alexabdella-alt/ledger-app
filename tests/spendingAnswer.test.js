import { describe, it, expect } from "vitest";
import { plainPeriodSummary, spendingSentence } from "../src/lib/plainSummary";
import { computeCategoryTotals, computeExpenses } from "../src/lib/reports";
import { containsOwnerJargon } from "../src/lib/clarify";
import { INVOICES } from "./helpers/populatedFixture";

// ═════════════════════════════════════════════════════════════════════════════
// O104 / C561 — "WHAT AM I SPENDING ON?" — the third of O104's three questions, answered in
// the Reports paragraph from the P&L's own source, so it cannot disagree with the report.
// ═════════════════════════════════════════════════════════════════════════════

describe("C561 — the biggest costs, in the owner's paragraph", () => {
  it("★★★ names the top three from the P&L's own totals, in order, with those exact figures", () => {
    const cats = computeCategoryTotals(INVOICES).filter((c) => c.total > 0);
    const s = plainPeriodSummary({ rangeInvoices: INVOICES, allInvoices: INVOICES, rangeLabel: "all time" });
    const top3 = cats.slice(0, 3);
    let at = -1;
    for (const c of top3) {
      const i = s.text.indexOf(c.category.replace(/\s*\([^)]*\)/g, "").trim());
      expect(i, c.category).toBeGreaterThan(at);   // present, and in descending order
      at = i;
    }
    expect(s.text).toMatch(/The biggest costs were /);
  });
  it("★★ and the totals it draws from add up to the period's spending — one source, not a second sum", () => {
    const sum = computeCategoryTotals(INVOICES).reduce((t, c) => t + c.total, 0);
    expect(Math.round(sum * 100)).toBe(Math.round(computeExpenses(INVOICES) * 100));
  });
  it("one category that is everything says so", () => {
    expect(spendingSentence([{ category: "Rent & Occupancy", total: 2400 }], 2400)).toBe("All of it went to Rent & Occupancy.");
  });
  it("one category that is not everything is 'the biggest cost'", () => {
    expect(spendingSentence([{ category: "Rent & Occupancy", total: 2400 }, { category: "Refunds", total: -50 }], 2350.5))
      .toBe("The biggest cost was Rent & Occupancy ($2,400.00).");
  });
  it("★ accountants' parentheticals are dropped, and the result passes the owner jargon bar", () => {
    const s = spendingSentence([
      { category: "Operating Lease Expense (ASC 842)", total: 900 },
      { category: "Technology & Software (SaaS)", total: 300 },
    ], 1200);
    expect(s).toBe("The biggest costs were Operating Lease Expense ($900.00) and Technology & Software ($300.00).");
    expect(containsOwnerJargon(s)).toBe(false);
  });
  it("★ a period with no spending says nothing about spending", () => {
    const s = plainPeriodSummary({ rangeInvoices: [], allInvoices: [], rangeLabel: "this month" });
    expect(s.text).not.toMatch(/biggest cost/);
    expect(spendingSentence([], 0)).toBeNull();
  });
});
