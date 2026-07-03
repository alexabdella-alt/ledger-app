import { describe, it, expect } from "vitest";
import { executeAITool } from "../src/lib/aiTools.js";
import { fmtSignedMoney } from "../src/lib/format.js";
import { glCashOnHand, businessHealth } from "../src/lib/reports.js";

// ════════════════════════════════════════════════════════════════════════════
// "AI numbers == dashboard to the penny" — made DETERMINISTIC (not prompt-hoped).
// The financial tools return every current balance/total as a pre-formatted
// `*_display` string the model copies verbatim, built with the SAME canonical
// formatter the dashboard uses (fmtSignedMoney). These tests lock:
//   1. the canonical formatter === the dashboard's cash/net formatting rule
//   2. the tool output contains the exact `*_display` strings
//   3. the tool's cash_balance_display === fmtSignedMoney(glCashOnHand(...)) ===
//      the dashboard formatter, penny-exact — for the real GL-derived cash figure.
// ════════════════════════════════════════════════════════════════════════════

// The dashboard's cash card formatter, replicated from DashboardView.jsx:72
// (`fmt = n => "$"+Math.abs(n||0).toLocaleString("en-US",{minimumFractionDigits:2})`).
// glCash is always r2'd (≤2 decimals), so min-2 and the canonical min/max-2 agree.
const dashboardCashFmt = n => "$" + Math.abs(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2 });
// The dashboard shows net income signed (DashboardView.jsx:160 prepends "-").
const dashboardSignedFmt = n => (n < 0 ? "-" : "") + "$" + Math.abs(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2 });

const mockCtx = (cashBalance, ledger = []) => ({
  cashBalance,
  getLedger: async () => ledger,
  chartOfAccounts: [], getAccountByRole: () => null, anomalies: [], recurring: [],
});

describe("canonical formatter === dashboard formatter (penny-exact)", () => {
  const positives = [0, 0.5, 12.34, 1000, 12345.67, 999999.99, 42.1];
  it("matches the dashboard cash card rule for every representative balance", () => {
    for (const v of positives) {
      expect(fmtSignedMoney(v)).toBe(dashboardCashFmt(v));
    }
  });
  it("matches the dashboard's SIGNED rule for net income (incl. negatives)", () => {
    for (const v of [-8165, -0.01, 0, 4200.5, -12345.67]) {
      expect(fmtSignedMoney(v)).toBe(dashboardSignedFmt(v));
    }
  });
});

describe("get_financial_summary returns exact pre-formatted display strings", () => {
  it("cash_balance_display is the canonical formatting of the passed glCash", async () => {
    const cash = 12345.67;
    const r = await executeAITool("get_financial_summary", {}, mockCtx(cash));
    expect(r.cash_balance).toBe(cash);
    expect(r.cash_balance_display).toBe("$12,345.67");
    expect(r.cash_balance_display).toBe(fmtSignedMoney(cash));
    expect(r.cash_balance_display).toBe(dashboardCashFmt(cash));   // == dashboard, to the penny
  });
  it("every current-actual field has a matching *_display; runway stays numeric", async () => {
    const r = await executeAITool("get_financial_summary", {}, mockCtx(1000.4));
    for (const k of ["total_revenue", "total_expenses", "net_income", "burn_rate", "cash_balance", "overdue_ar_total", "unpaid_ap_total"]) {
      expect(r[`${k}_display`], `${k}_display missing`).toBe(fmtSignedMoney(r[k]));
    }
    expect(r.cash_balance_display).toBe("$1,000.40");
    expect(typeof r.runway_months === "number" || r.runway_months === null).toBe(true);
    expect(r.runway_months_display).toBeUndefined();   // estimate — deliberately NOT pre-formatted
  });
});

describe("the reported bug is now deterministic — GL-derived cash, tool == dashboard", () => {
  it("cash_balance_display === fmtSignedMoney(glCashOnHand(ledger)) === dashboard, penny-exact", async () => {
    // A tiny GL: opening $10,000.00 into cash (1000), then a $3,654.33 expense paid from cash.
    const ledger = [
      { id: "o1", date: "2026-01-01", gl_code: "1000", debit: 10000, credit: 0, amount: 10000, secondary_gl_code: "3400" },
      { id: "o1b", date: "2026-01-01", gl_code: "3400", debit: 0, credit: 10000, amount: 10000 },
      { id: "e1", date: "2026-02-01", gl_code: "6100", debit: 3654.33, credit: 0, amount: 3654.33, secondary_gl_code: "1000" },
      { id: "e1b", date: "2026-02-01", gl_code: "1000", debit: 0, credit: 3654.33, amount: 3654.33 },
    ];
    const cashCodes = ["1000"];
    const glCash = glCashOnHand(ledger, cashCodes);
    const r = await executeAITool("get_financial_summary", {}, mockCtx(glCash, ledger));
    expect(r.cash_balance_display).toBe(fmtSignedMoney(glCash));
    expect(r.cash_balance_display).toBe(dashboardCashFmt(glCash));   // the guarantee, penny-exact
  });
});

describe("dashboard === chatbot: ONE canonical cash string (the $49,213.50 case)", () => {
  // The exact bug the user hit: glCash = 49213.50. The dashboard's key-numbers card
  // used to round-half-up to "$49,214" while the chatbot showed the exact/floored
  // figure → a $1 gap that could never reconcile. Now both derive from the same
  // sum-then-round-once value and the same formatter, so they're byte-identical.
  const ledger = [
    { id: "o",  date: "2026-01-01", gl_code: "1000", debit: 49213.50, credit: 0, amount: 49213.50, secondary_gl_code: "3400" },
    { id: "o2", date: "2026-01-01", gl_code: "3400", debit: 0, credit: 49213.50, amount: 49213.50 },
  ];

  it("glCashOnHand sums-then-rounds ONCE to the exact cents value", () => {
    expect(glCashOnHand(ledger, ["1000"])).toBe(49213.5);
  });

  it("businessHealth cash fact === tool cash_balance_display === fmtSignedMoney(glCash)", async () => {
    const glCash = glCashOnHand(ledger, ["1000"]);
    const dashCash = businessHealth(ledger, { cash: glCash }).facts.find(f => f.key === "cash").value;
    const tool = await executeAITool("get_financial_summary", {}, mockCtx(glCash, ledger));

    expect(dashCash).toBe("$49,213.50");                // exact cents (was "$49,214" round-half-up)
    expect(dashCash).not.toBe("$49,214");               // the whole-dollar divergence is gone
    expect(dashCash).toBe(fmtSignedMoney(glCash));      // dashboard uses the canonical formatter
    expect(tool.cash_balance_display).toBe(dashCash);   // chatbot copies the identical string
  });
});

describe("category / vendor / overdue / search totals carry display strings", () => {
  const ledger = [
    { id: "a", date: "2026-03-01", gl_code: "6500", debit: 120.5, credit: 0, amount: 120.5, vendor: "AWS", type: "expense" },
    { id: "b", date: "2026-03-02", gl_code: "6500", debit: 79.5, credit: 0, amount: 79.5, vendor: "AWS", type: "expense" },
  ];
  it("get_category_totals: each category has total_display", async () => {
    const r = await executeAITool("get_category_totals", { period: "all_time" }, mockCtx(0, ledger));
    for (const c of r.categories) expect(c.total_display).toBe(fmtSignedMoney(c.total));
  });
  it("get_vendor_summary: each vendor has total_display", async () => {
    const r = await executeAITool("get_vendor_summary", { period: "all_time" }, mockCtx(0, ledger));
    for (const v of r.vendors) expect(v.total_display).toBe(fmtSignedMoney(v.total));
  });
  it("search_transactions: total_amount_display + per-row amount_display", async () => {
    const r = await executeAITool("search_transactions", { vendor: "AWS" }, mockCtx(0, ledger));
    expect(r.total_amount_display).toBe(fmtSignedMoney(r.total_amount));
    for (const t of r.transactions) expect(t.amount_display).toBe(fmtSignedMoney(t.amount));
  });
});
