import { describe, it, expect } from "vitest";
import {
  isLiveEntry, liveEntries, computeRevenue, computeExpenses, computeNetIncome,
  computeCategoryTotals, computeVendorTotals, computeAR, computeAP,
  computeBurnRate, computeRunway, computeCashPosition,
  agingReport, trialBalance, buildMonthlyReport,
} from "../src/lib/reports.js";
import { glIsRevenue, glIsExpense } from "../src/lib/gl.js";
import { executeAITool } from "../src/lib/aiTools.js";

// ════════════════════════════════════════════════════════════════════════════
// THE RECONCILIATION LOCK.
// A deliberately nasty fixture exercising every filter edge: voided, soft-deleted,
// prior-year, opening balances, qbo_import, multi-line, unpaid AR/AP, a flagged
// entry, and year-boundary dates. Every surface must agree to the penny.
// If a future change breaks reconciliation, these tests fail in CI.
// ════════════════════════════════════════════════════════════════════════════

const YEAR = new Date().getFullYear();
const PRIOR = YEAR - 1;
const PAST_DUE = "2000-01-01";           // always in the past → deterministic "overdue"

// Flattened-invoice factory (the shape every compute* function consumes).
const e = (o) => ({
  id: o.id, vendor: o.vendor, amount: o.amount, date: o.date,
  gl_code: o.gl_code, gl_name: o.gl_name || o.gl_code,
  debit_credit: o.debit_credit, secondary_gl_code: o.secondary_gl_code || null,
  secondary_gl_name: o.secondary_gl_name || null,
  payment_status: o.payment_status || "paid", due_date: o.due_date || null,
  source: o.source || "manual", status: o.status || "booked",
  deleted_at: o.deleted_at || null, approval_status: o.approval_status || null,
  type: glIsRevenue(o.gl_code) ? "revenue" : glIsExpense(o.gl_code) ? "expense" : "other",
});

const FIX = [
  // ── This year (all in March, so monthly[March] === YTD for the P&L lines) ──
  e({ id: "a", vendor: "AWS",      amount: 100, date: `${YEAR}-03-10`, gl_code: "6500", debit_credit: "debit",  secondary_gl_code: "1000", payment_status: "paid" }),
  e({ id: "b", vendor: "WeWork",   amount: 200, date: `${YEAR}-03-11`, gl_code: "6100", debit_credit: "debit",  secondary_gl_code: "2000", payment_status: "unpaid",    due_date: PAST_DUE }),
  e({ id: "c", vendor: "ClientCo", amount: 500, date: `${YEAR}-03-12`, gl_code: "4000", debit_credit: "credit", secondary_gl_code: "1000", payment_status: "collected" }),
  e({ id: "d", vendor: "BigCorp",  amount: 300, date: `${YEAR}-03-13`, gl_code: "4000", debit_credit: "credit", secondary_gl_code: "1200", payment_status: "unpaid",    due_date: PAST_DUE }),
  e({ id: "i", vendor: "Verizon",  amount: 150, date: `${YEAR}-03-14`, gl_code: "6200", debit_credit: "debit",  secondary_gl_code: "1000", payment_status: "paid", source: "qbo_import" }),
  e({ id: "k", vendor: "AWS",      amount: 50,  date: `${YEAR}-03-15`, gl_code: "6500", debit_credit: "debit",  secondary_gl_code: "1000", payment_status: "paid", approval_status: "flagged" }),
  // Multi-line payroll (ids carry "_" → primary-side only in TB / balance sheet)
  e({ id: "pr_0", vendor: "Payroll", amount: 800,  date: `${YEAR}-03-20`, gl_code: "6000", debit_credit: "debit",  secondary_gl_code: "1000" }),
  e({ id: "pr_1", vendor: "Payroll", amount: 200,  date: `${YEAR}-03-20`, gl_code: "6700", debit_credit: "debit",  secondary_gl_code: "1000" }),
  e({ id: "pr_2", vendor: "Payroll", amount: 1000, date: `${YEAR}-03-20`, gl_code: "1000", debit_credit: "credit", secondary_gl_code: "6000" }),
  // Year-boundary: still THIS year (December)
  e({ id: "l", vendor: "AWS", amount: 25, date: `${YEAR}-12-31`, gl_code: "6500", debit_credit: "debit", secondary_gl_code: "1000", payment_status: "paid" }),

  // ── Prior year (excluded from YTD, included all-time). NB: ids must not contain
  //    "_" — that marks a multi-line expansion (offset booked once) in TB/balance sheet. ──
  e({ id: "px", vendor: "OldVendor", amount: 999,  date: `${PRIOR}-06-01`, gl_code: "6500", debit_credit: "debit",  secondary_gl_code: "1000", payment_status: "paid" }),
  e({ id: "pv", vendor: "OldClient", amount: 5000, date: `${PRIOR}-12-31`, gl_code: "4000", debit_credit: "credit", secondary_gl_code: "1000", payment_status: "collected" }),
  // Opening balance: equity ↔ cash, balance-sheet only (no P&L)
  e({ id: "ob", vendor: "Opening Balance", amount: 5000, date: `${PRIOR}-01-01`, gl_code: "3000", debit_credit: "credit", secondary_gl_code: "1000", source: "opening_balance" }),

  // ── Must be EXCLUDED everywhere ──
  e({ id: "void", vendor: "AWS", amount: 777, date: `${YEAR}-03-09`, gl_code: "6500", debit_credit: "debit", secondary_gl_code: "1000", status: "voided" }),
  e({ id: "del",  vendor: "AWS", amount: 888, date: `${YEAR}-03-08`, gl_code: "6500", debit_credit: "debit", secondary_gl_code: "1000", deleted_at: "2025-01-01T00:00:00Z" }),
];

const YTD = { from: `${YEAR}-01-01`, to: `${YEAR}-12-31` };
const MARCH = { from: `${YEAR}-03-01`, to: `${YEAR}-03-31` };
const CASH = "12345.67";
const ctx = { getLedger: async () => FIX, cashBalance: CASH, anomalies: [], recurring: [], getAccountByRole: () => null };

// Independent re-implementation of the P&L report's accrual math (NOT via canonical),
// so the test catches the canonical layer drifting from intended P&L semantics.
function plReport(range) {
  const f = FIX.filter(i => i.status !== "voided" && i.status !== "deleted" && !i.deleted_at)
    .filter(i => (!range.from || i.date >= range.from) && (!range.to || i.date <= range.to));
  const rev = f.filter(i => glIsRevenue(i.gl_code)).reduce((s, i) => s + i.amount, 0);
  const exp = f.filter(i => glIsExpense(i.gl_code)).reduce((s, i) => s + i.amount, 0);
  return { rev, exp, net: rev - exp };
}

describe("liveness predicate excludes voided + soft-deleted", () => {
  it("drops voided and deleted, keeps the rest (incl. flagged/qbo/opening/multi-line)", () => {
    const live = FIX.filter(isLiveEntry);
    expect(live.find(i => i.id === "void")).toBeUndefined();
    expect(live.find(i => i.id === "del")).toBeUndefined();
    expect(live.find(i => i.id === "k")).toBeDefined();    // flagged is still posted/live
    expect(live.find(i => i.id === "i")).toBeDefined();    // qbo_import
    expect(live.length).toBe(FIX.length - 2);
  });
});

describe("net income reconciles across every surface (same period)", () => {
  it("dashboard YTD === P&L YTD === AI get_financial_summary === canonical", async () => {
    const canonical = computeNetIncome(FIX, YTD);
    const pl = plReport(YTD).net;
    const ai = await executeAITool("get_financial_summary", { period: "this_year" }, ctx);
    expect(pl).toBe(canonical);
    expect(ai.net_income).toBe(canonical);
    expect(ai.total_revenue).toBe(computeRevenue(FIX, YTD));
    expect(ai.total_expenses).toBe(computeExpenses(FIX, YTD));
    // prior-year + voided + deleted excluded from YTD
    expect(canonical).toBe(800 - 1525);
  });

  it("monthly report net === canonical net for the same month", () => {
    const m = buildMonthlyReport(`${YEAR}-03`, { invoices: FIX, cashBalance: CASH });
    expect(m.pl.net_income.current).toBe(computeNetIncome(FIX, MARCH));
    expect(m.pl.revenue.current).toBe(computeRevenue(FIX, MARCH));
    expect(m.pl.expenses_total.current).toBe(computeExpenses(FIX, MARCH));
  });
});

describe("category totals reconcile and sum to total expenses", () => {
  it("Σ canonical categories === total expenses === Σ AI get_category_totals", async () => {
    const cats = computeCategoryTotals(FIX, YTD);
    const sumCats = Math.round(cats.reduce((s, c) => s + c.total, 0) * 100) / 100;
    const totalExp = computeExpenses(FIX, YTD);
    expect(sumCats).toBe(totalExp);

    const ai = await executeAITool("get_category_totals", { period: "this_year" }, ctx);
    const sumAi = Math.round(ai.categories.reduce((s, c) => s + c.total, 0) * 100) / 100;
    expect(sumAi).toBe(totalExp);
    // multi-line expense lines both counted (6000 + 6700), nothing double-counted
    expect(cats.find(c => c.gl_code === "6000").total).toBe(800);
    expect(cats.find(c => c.gl_code === "6700").total).toBe(200);
  });
});

describe("trial balance balances and reconciles to net income", () => {
  const tb = trialBalance(FIX);
  it("debits === credits", () => {
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });
  it("TB net of P&L accounts === all-time net income", () => {
    const plNet = tb.accounts
      .filter(a => /^[4-8]/.test(a.code))
      .reduce((s, a) => s + (a.credit - a.debit), 0);   // revenue credit − expense debit
    expect(Math.round(plNet * 100) / 100).toBe(computeNetIncome(FIX));   // all-time
  });
});

describe("balance sheet identity: Assets === Liabilities + Equity + net income", () => {
  it("holds (derived from the balanced trial balance)", () => {
    const tb = trialBalance(FIX);
    const cls = (re) => tb.accounts.filter(a => re.test(a.code));
    const assets = cls(/^1/).reduce((s, a) => s + (a.debit - a.credit), 0);
    const liab   = cls(/^2/).reduce((s, a) => s + (a.credit - a.debit), 0);
    const equity = cls(/^3/).reduce((s, a) => s + (a.credit - a.debit), 0);
    const net    = computeNetIncome(FIX);
    expect(Math.round(assets * 100) / 100).toBe(Math.round((liab + equity + net) * 100) / 100);
  });
});

describe("AR / AP reconcile across aging, dashboard total, and AI overdue", () => {
  const now = new Date();
  it("AR aging total === canonical AR total === AI get_overdue (ar) total", async () => {
    const aging = agingReport(FIX, "ar", now);
    const ar = computeAR(FIX, { now });
    const ai = await executeAITool("get_overdue_invoices", { type: "ar" }, ctx);
    expect(aging.total).toBe(ar.total);
    expect(ar.total).toBe(300);                       // only the one unpaid receivable
    expect(ar.overdue).toBe(ar.total);                // all past-due → overdue === total
    expect(ai.total).toBe(ar.overdue);
  });
  it("AP aging total === canonical AP total === AI get_overdue (ap) total", async () => {
    const aging = agingReport(FIX, "ap", now);
    const ap = computeAP(FIX, { now });
    const ai = await executeAITool("get_overdue_invoices", { type: "ap" }, ctx);
    expect(aging.total).toBe(ap.total);
    expect(ap.total).toBe(200);
    expect(ai.total).toBe(ap.overdue);
  });
});

describe("vendor totals reconcile between the report and the AI", () => {
  it("canonical computeVendorTotals === AI get_vendor_summary (per vendor)", async () => {
    const report = computeVendorTotals(FIX);                       // all-time, P&L scope
    const ai = await executeAITool("get_vendor_summary", { period: "all_time" }, ctx);
    const reportMap = Object.fromEntries(report.map(v => [v.vendor, v.total]));
    const aiMap = Object.fromEntries(ai.vendors.map(v => [v.vendor, v.total]));
    expect(aiMap).toEqual(reportMap);
    // AWS = 100 + 50 + 25 (this yr) — voided 777 / deleted 888 excluded
    expect(reportMap["AWS"]).toBe(175);
  });
});

describe("cash, burn, runway share one definition", () => {
  it("cash position prefers the explicit balance", () => {
    expect(computeCashPosition({ cashBalance: CASH })).toBe(12345.67);
  });
  it("runway === cash ÷ trailing burn, consistently", () => {
    const burn = computeBurnRate(FIX, { asOf: `${YEAR}-12-31` });
    const cash = computeCashPosition({ cashBalance: CASH });
    expect(computeRunway(cash, burn)).toBe(Math.round((cash / burn) * 10) / 10);
  });
});
