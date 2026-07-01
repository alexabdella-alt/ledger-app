import { describe, it, expect } from "vitest";
import { buildMonthlyReport, priorPeriod, formatPeriod } from "../src/lib/reports.js";

// Minimal flattened-invoice factory matching the shape buildMonthlyReport reads.
const inv = (o) => ({
  id: o.id || Math.random().toString(36).slice(2),
  date: o.date, amount: o.amount, gl_code: o.gl_code, gl_name: o.gl_name,
  type: o.type, vendor: o.vendor || null,
  payment_status: o.payment_status || "paid", due_date: o.due_date || null,
  status: o.status || "posted",
});

describe("priorPeriod / formatPeriod", () => {
  it("rolls back across month and year boundaries", () => {
    expect(priorPeriod("2026-05")).toBe("2026-04");
    expect(priorPeriod("2026-01")).toBe("2025-12");
  });
  it("formats a human label", () => {
    expect(formatPeriod("2026-05")).toBe("May 2026");
    expect(formatPeriod("2025-12")).toBe("December 2025");
  });
});

describe("buildMonthlyReport — month with activity", () => {
  const invoices = [
    // May 2026 (target)
    inv({ date: "2026-05-04", amount: 10000, gl_code: "4000", gl_name: "Service Revenue", type: "revenue" }),
    inv({ date: "2026-05-12", amount: 2500, gl_code: "6500", gl_name: "Software & Apps", type: "expense", vendor: "AWS" }),
    inv({ date: "2026-05-20", amount: 1500, gl_code: "6100", gl_name: "Rent", type: "expense", vendor: "WeWork" }),
    inv({ date: "2026-05-22", amount: 500, gl_code: "6500", gl_name: "Software & Apps", type: "expense", vendor: "AWS" }),
    // open receivable (unpaid, overdue relative to May 31)
    inv({ date: "2026-05-02", amount: 4000, gl_code: "4000", gl_name: "Service Revenue", type: "revenue", payment_status: "unpaid", due_date: "2026-03-01" }),
    // April 2026 (prior)
    inv({ date: "2026-04-10", amount: 8000, gl_code: "4000", gl_name: "Service Revenue", type: "revenue" }),
    inv({ date: "2026-04-15", amount: 2000, gl_code: "6500", gl_name: "Software & Apps", type: "expense", vendor: "AWS" }),
    // March 2026 (for burn trailing window)
    inv({ date: "2026-03-09", amount: 1800, gl_code: "6100", gl_name: "Rent", type: "expense", vendor: "WeWork" }),
  ];
  const r = buildMonthlyReport("2026-05", { invoices, cashBalance: 20000 });

  it("computes P&L revenue, expenses, and net income for the month", () => {
    // revenue: 10000 + 4000 = 14000; expenses: 2500 + 1500 + 500 = 4500; net = 9500
    expect(r.pl.revenue.current).toBe(14000);
    expect(r.pl.expenses_total.current).toBe(4500);
    expect(r.pl.net_income.current).toBe(9500);
  });
  it("computes month-over-month comparison vs the prior month", () => {
    // prior revenue 8000, prior expenses 2000, prior net 6000
    expect(r.pl.revenue.prior).toBe(8000);
    expect(r.pl.revenue.change).toBe(6000);
    expect(r.pl.revenue.changePct).toBe(75);          // (14000-8000)/8000 = 75%
    expect(r.pl.net_income.prior).toBe(6000);
  });
  it("aggregates expense lines by category, sorted by spend", () => {
    const software = r.pl.expense_lines.find(l => l.category === "Software & Apps");
    expect(software.current).toBe(3000);              // 2500 + 500
    expect(r.pl.expense_lines[0].current).toBeGreaterThanOrEqual(r.pl.expense_lines[1].current);
  });
  it("ranks top vendors by spend", () => {
    expect(r.top_vendors[0]).toEqual({ vendor: "AWS", total: 3000 });
    expect(r.top_vendors[1]).toEqual({ vendor: "WeWork", total: 1500 });
  });
  it("reports cash, a trailing-3-month burn rate, and runway", () => {
    expect(r.cash.cash_on_hand).toBe(20000);
    // trailing 3 months of expense: Mar 1800, Apr 2000, May 4500 → avg 2766.67
    expect(r.cash.burn_rate).toBeCloseTo(2766.67, 1);
    expect(r.cash.runway_months).toBeCloseTo(20000 / 2766.67, 0);
  });
  it("surfaces AR totals and overdue amounts", () => {
    expect(r.receivables.total).toBe(4000);           // the one unpaid invoice
    expect(r.receivables.overdue).toBe(4000);         // due 2026-03-01, well past May 31
  });
  it("includes the 5 KPIs and plain-language health (no removed 0–100 score/grade)", () => {
    expect(r.kpis).toHaveLength(5);
    expect(["good", "watch", "concern"]).toContain(r.health.tone);
    expect(typeof r.health.headline).toBe("string");
    expect(r.health.headline.length).toBeGreaterThan(0);
    expect(r.health).not.toHaveProperty("score");   // the removed system must not resurface
    expect(r.health).not.toHaveProperty("grade");
  });
  it("writes a non-empty templated executive summary", () => {
    expect(r.summary).toContain("May 2026");
    expect(r.summary.length).toBeGreaterThan(40);
    expect(r.summary).not.toMatch(/NaN|undefined/);
  });
  it("carries period metadata", () => {
    expect(r.period).toBe("2026-05");
    expect(r.prior_period).toBe("2026-04");
    expect(r.label).toBe("May 2026");
    expect(r.transaction_count).toBe(5);
  });
});

describe("buildMonthlyReport — month with no activity", () => {
  const r = buildMonthlyReport("2026-05", { invoices: [], cashBalance: 0 });
  it("returns zeroed figures with no NaN/undefined", () => {
    expect(r.pl.revenue.current).toBe(0);
    expect(r.pl.expenses_total.current).toBe(0);
    expect(r.pl.net_income.current).toBe(0);
    expect(r.pl.revenue.changePct).toBeNull();        // no prior basis → null, not NaN
    expect(r.cash.burn_rate).toBe(0);
    expect(r.cash.runway_months).toBeNull();
    expect(r.top_vendors).toEqual([]);
    expect(r.anomalies).toEqual([]);
    expect(r.transaction_count).toBe(0);
  });
  it("still produces all 5 KPIs and plain-language health", () => {
    expect(r.kpis).toHaveLength(5);
    expect(["good", "watch", "concern"]).toContain(r.health.tone);
    expect(typeof r.health.headline).toBe("string");
  });
  it("writes a sensible no-activity summary", () => {
    expect(r.summary).toMatch(/No transactions/i);
    expect(r.summary).toContain("May 2026");
    expect(r.summary).not.toMatch(/NaN|undefined/);
  });
});

describe("buildMonthlyReport — divide-by-zero MoM safety", () => {
  it("returns null changePct when the prior month is zero but current is non-zero", () => {
    const invoices = [inv({ date: "2026-05-01", amount: 5000, gl_code: "4000", gl_name: "Service Revenue", type: "revenue" })];
    const r = buildMonthlyReport("2026-05", { invoices, cashBalance: 5000 });
    expect(r.pl.revenue.current).toBe(5000);
    expect(r.pl.revenue.prior).toBe(0);
    expect(r.pl.revenue.changePct).toBeNull();
    expect(r.pl.revenue.change).toBe(5000);
  });
});
