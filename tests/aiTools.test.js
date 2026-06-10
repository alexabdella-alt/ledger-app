import { describe, it, expect } from "vitest";
import { executeAITool, AI_TOOLS } from "../src/lib/aiTools.js";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../src/lib/constants.js";

// Resolve roles the way useAccounts does, for get_tax_summary deductions.
const byRole = Object.fromEntries(DEFAULT_CHART_OF_ACCOUNTS.map(a => [a.system_role, a]));
const getAccountByRole = (role) => byRole[role] || null;

const Y = new Date().getFullYear();
const LEDGER = [
  { id: 1, vendor: "Adobe", amount: 52.99, date: `${Y}-02-01`, gl_code: "6500", gl_name: "Technology & Software", type: "expense", status: "posted", payment_status: "paid" },
  { id: 2, vendor: "Adobe", amount: 52.99, date: `${Y}-03-01`, gl_code: "6500", gl_name: "Technology & Software", type: "expense", status: "posted", payment_status: "paid" },
  { id: 3, vendor: "Rent LLC", amount: 2000, date: `${Y}-02-01`, gl_code: "6100", gl_name: "Rent & Occupancy", type: "expense", status: "posted", payment_status: "paid" },
  { id: 4, vendor: "Acme", amount: 10000, date: `${Y}-02-01`, gl_code: "4000", gl_name: "Product Revenue", type: "revenue", status: "posted", payment_status: "collected" },
  { id: 5, vendor: "Acme", amount: 5000, date: `${Y}-01-15`, gl_code: "4000", gl_name: "Product Revenue", type: "revenue", status: "posted", payment_status: "unpaid", due_date: "2020-01-01" }, // overdue AR
  { id: 6, vendor: "Gas Co", amount: 800, date: `${Y}-01-10`, gl_code: "6200", gl_name: "Utilities", type: "expense", status: "posted", payment_status: "unpaid", due_date: "2020-01-01" }, // overdue AP
  { id: 7, vendor: "Voided Co", amount: 9999, date: `${Y}-02-01`, gl_code: "6500", gl_name: "Technology & Software", type: "expense", status: "voided" }, // excluded everywhere
];

const ctx = {
  getLedger: async () => LEDGER,
  cashBalance: 20000,
  recurring: [{ vendor: "Slack", amount: 28.5, frequency: "monthly", next_date: `${Y}-07-01`, gl_code: "6500", gl_name: "Technology & Software" }],
  anomalies: null,           // null → get_anomalies computes from the ledger
  getAccountByRole,
};

describe("AI tool definitions", () => {
  it("exposes all 8 tools with valid Anthropic schemas", () => {
    const names = AI_TOOLS.map(t => t.name).sort();
    expect(names).toEqual([
      "get_anomalies", "get_category_totals", "get_financial_summary", "get_overdue_invoices",
      "get_recurring_transactions", "get_tax_summary", "get_vendor_summary", "search_transactions",
    ]);
    for (const t of AI_TOOLS) {
      expect(typeof t.description).toBe("string");
      expect(t.input_schema.type).toBe("object");
    }
  });
});

describe("executeAITool", () => {
  it("get_vendor_summary: 'how much did I spend on Adobe?' → exact total", async () => {
    const out = await executeAITool("get_vendor_summary", { vendor: "Adobe" }, ctx);
    expect(out.vendors).toHaveLength(1);
    expect(out.vendors[0].vendor).toBe("Adobe");
    expect(out.vendors[0].total).toBe(105.98); // 52.99 × 2
    expect(out.vendors[0].count).toBe(2);
  });

  it("search_transactions: filters by vendor, excludes voided, sorts date desc", async () => {
    const out = await executeAITool("search_transactions", { vendor: "Adobe" }, ctx);
    expect(out.count).toBe(2);
    expect(out.total_amount).toBe(105.98);
    // Most recent first (so the AI lists latest matches first when disambiguating).
    expect(out.transactions[0].date >= out.transactions[1].date).toBe(true);
    expect(out.transactions[0].date).toBe(`${Y}-03-01`);
    const out2 = await executeAITool("search_transactions", { vendor: "Voided" }, ctx);
    expect(out2.count).toBe(0); // voided entries never returned
  });

  it("get_category_totals: complete + sorted high→low, voided excluded", async () => {
    const out = await executeAITool("get_category_totals", { period: "all_time" }, ctx);
    expect(out.categories[0]).toMatchObject({ gl_code: "6100", total: 2000 }); // Rent largest
    const tech = out.categories.find(c => c.gl_code === "6500");
    expect(tech.total).toBe(105.98); // voided $9999 excluded
  });

  it("get_financial_summary: revenue/expenses/net/overdue are exact", async () => {
    const out = await executeAITool("get_financial_summary", { period: "all_time" }, ctx);
    expect(out.total_revenue).toBe(15000);     // 10000 + 5000
    expect(out.total_expenses).toBe(2905.98);  // 52.99+52.99+2000+800 (voided excluded)
    expect(out.net_income).toBe(12094.02);
    expect(out.overdue_ar_total).toBe(5000);
    expect(out.unpaid_ap_total).toBe(800);
    expect(out.cash_balance).toBe(20000);
    expect(out.burn_rate).toBeGreaterThan(0);
  });

  it("get_overdue_invoices: returns past-due unpaid AR + AP", async () => {
    const out = await executeAITool("get_overdue_invoices", { type: "both" }, ctx);
    expect(out.count).toBe(2);
    expect(out.total).toBe(5800);
    const ar = out.invoices.find(i => i.kind === "ar");
    expect(ar.amount).toBe(5000);
    const apOnly = await executeAITool("get_overdue_invoices", { type: "ap" }, ctx);
    expect(apOnly.count).toBe(1);
    expect(apOnly.invoices[0].vendor).toBe("Gas Co");
  });

  it("get_anomalies: computes the current list when none passed", async () => {
    const out = await executeAITool("get_anomalies", {}, ctx);
    expect(Array.isArray(out.anomalies)).toBe(true);
    expect(out.count).toBeGreaterThanOrEqual(1); // Adobe charged the same amount twice → duplicate
  });

  it("get_tax_summary: returns estimate + deductions for the year", async () => {
    const out = await executeAITool("get_tax_summary", { year: Y }, ctx);
    expect(typeof out.estimated_tax).toBe("number");
    expect(typeof out.total_owed).toBe("number");
    expect(Array.isArray(out.deductions_by_category)).toBe(true);
    expect(out.next_deadline).toBeTruthy();
  });

  it("get_recurring_transactions: lists the rules", async () => {
    const out = await executeAITool("get_recurring_transactions", {}, ctx);
    expect(out.count).toBe(1);
    expect(out.recurring[0].vendor).toBe("Slack");
    expect(out.recurring[0].frequency).toBe("monthly");
  });

  it("unknown tool returns an error object (sandbox-safe)", async () => {
    const out = await executeAITool("drop_tables", {}, ctx);
    expect(out.error).toMatch(/unknown tool/i);
  });
});
