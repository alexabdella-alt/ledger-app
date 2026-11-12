import { describe, it, expect } from "vitest";
import { executeAITool, AI_TOOLS } from "../src/lib/aiTools.js";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../src/lib/constants.js";

// C615 — review finding R4: the assistant's "unpaid" figure was the OVERDUE part only.
const byRole = Object.fromEntries(DEFAULT_CHART_OF_ACCOUNTS.map((a) => [a.system_role, a]));
const Y = new Date().getFullYear() + 1;   // due next year: unpaid, NOT overdue
const ledger = [
  { id: 1, vendor: "Gas Co", amount: 800, date: `${Y - 1}-12-10`, gl_code: "6200", gl_name: "Utilities", secondary_gl_code: "2000", type: "expense", status: "posted", payment_status: "unpaid", due_date: `${Y}-06-30` },
  { id: 2, vendor: "Acme", amount: 5000, date: `${Y - 1}-12-15`, gl_code: "4000", gl_name: "Product Revenue", secondary_gl_code: "1100", type: "revenue", status: "posted", payment_status: "unpaid", due_date: `${Y}-06-30` },
];
const ctx = { getLedger: async () => ledger, cashBalance: 0, recurring: [], anomalies: null, getAccountByRole: (r) => byRole[r] || null };

describe("'how much do I owe?' is answered with everything owed", () => {
  it("★ bills not yet due are still unpaid", async () => {
    const out = await executeAITool("get_financial_summary", { period: "all_time" }, ctx);
    expect(out.unpaid_ap_total).toBe(800);   // was 0: only overdue was reported
    expect(out.overdue_ap_total).toBe(0);
    expect(out.unpaid_ar_total).toBe(5000);
    expect(out.overdue_ar_total).toBe(0);
  });

  it("the tool's description says both", () => {
    const t = AI_TOOLS.find((x) => x.name === "get_financial_summary");
    expect(t.description).toMatch(/all unpaid, and the overdue part/);
  });
});
