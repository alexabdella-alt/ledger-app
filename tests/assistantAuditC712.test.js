// C712 — fixes from the assistant audit.
import { describe, it, expect, vi } from "vitest";
vi.mock("../src/lib/supabase", () => ({ supabase: {}, getAuthHeaders: async () => ({}) }));
import { readFileSync } from "node:fs";
import { executeAITool } from "../src/lib/aiTools.js";
import { resolveActionTargets, describeDestructiveAction } from "../src/lib/aiActionGate.js";
import { parseAIReply } from "../src/lib/ai.js";

const roles = { accounts_payable: { code: "2000" }, accounts_receivable: { code: "1100" } };
const getAccountByRole = (r) => roles[r] || null;
const today = new Date().toISOString().slice(0, 10);
const far = `${Number(today.slice(0, 4)) + 1}-12-30`;
const LED = [
  { id: "s_1", db_entry_id: "s", vendor: "Sysco", amount: 3000, gl_code: "5000", gl_name: "Cost of Goods Sold", debit_credit: "debit", date: "2026-11-01", due_date: far, status: "posted", payment_status: "unpaid" },
  { id: "s_2", db_entry_id: "s", vendor: "Sysco", amount: 3000, gl_code: "5000", gl_name: "Cost of Goods Sold", debit_credit: "debit", date: "2026-11-01", due_date: far, status: "posted", payment_status: "unpaid" },
  { id: "s_3", db_entry_id: "s", vendor: "Sysco", amount: 6000, gl_code: "2000", gl_name: "Accounts Payable", debit_credit: "credit", date: "2026-11-01", due_date: far, status: "posted", payment_status: "unpaid" },
  { id: "ob", db_entry_id: "ob", vendor: "Opening balances", amount: 2000, gl_code: "1000", secondary_gl_code: "2000", debit_credit: "debit", date: "2026-01-01", status: "posted", source: "opening_balance" },   // bills carried in the starting balances
  { id: "eq", db_entry_id: "eq", vendor: "Oven Co", amount: 4000, gl_code: "1500", secondary_gl_code: "2000", debit_credit: "debit", date: "2026-01-01", due_date: "2026-02-01", status: "posted", payment_status: "unpaid" },
];
const ctx = { getLedger: async () => LED, getAccountByRole, chartOfAccounts: [], contacts: [] };

describe("C712 — 'what do I owe?' is one figure", () => {
  it("get_bills_to_pay gives everything owed (the bills account's balance) and the due-soon part separately", async () => {
    const out = await executeAITool("get_bills_to_pay", {}, ctx);
    expect(out.owed_in_all).toBe(12000);   // the account's balance — the starting-balance bills included, as on Home
    expect(out.due_soon_total).toBe(6000);   // the overdue oven bill + the carried-over bills (no due date); not the Sysco bill due next year
    expect(out.bills.map((b) => b.vendor)).toContain("Bills carried over from your starting balances");
  });
  it("get_financial_summary's unpaid_ap_total is the same balance", async () => {
    expect((await executeAITool("get_financial_summary", {}, ctx)).unpaid_ap_total).toBe(12000);
  });
  it("an overdue bill for equipment is in the overdue list", async () => {
    const out = await executeAITool("get_overdue_invoices", { type: "ap" }, ctx);
    expect(JSON.stringify(out)).toMatch(/Oven Co/);
  });
});

describe("C712 — 1099 answers come from the 1099 screen's rules", () => {
  it("the tool exists and answers by year paid, with the floor", async () => {
    const out = await executeAITool("get_1099_summary", { year: 2026 }, ctx);
    expect(out).toMatchObject({ year: 2026, reporting_floor: 2000 });
    expect(Array.isArray(out.needs_1099)).toBe(true);
    const srv = readFileSync("supabase/functions/ai-proxy/aiProfiles.js", "utf8");
    expect(srv).toMatch(/name: "get_1099_summary"/);
    expect(srv).toMatch(/call get_1099_summary \(C712\) and answer from it/);
    expect(srv).not.toMatch(/total paid this year from the ledger/);
    expect(srv).not.toMatch(/\(total ÷ 4\)/);
    expect(srv).not.toMatch(/use payment_status to determine actual cash movement/);
  });
});

describe("C712 — voids are capped and narrowed; one bill is one bill", () => {
  it("a void by vendor narrows by amount and date", () => {
    const L = [{ id: "a", vendor: "Sysco", amount: 6000, date: "2026-11-01", status: "posted" }, { id: "b", vendor: "Sysco", amount: 900, date: "2026-11-01", status: "posted" }, { id: "c", vendor: "Sysco", amount: 6000, date: "2026-10-01", status: "posted" }];
    expect(resolveActionTargets({ type: "void_invoice", vendor: "Sysco", amount: 6000, date: "2026-11-01" }, { invoices: L }).map((r) => r.id)).toEqual(["a"]);
  });
  it("the cap counts voids, reversals and payments; the ambiguity check is per entry with plain names", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/else if \(\["void_invoice", "reverse_entry", "record_payment"\]\.includes\(a\.type\)\) pendingDeletes \+=/);
    expect(app).toMatch(/const matches = a\.type === "recode" \? matchInvoicesFor\(a\) : resolveActionTargets\(a, \{ invoices, contracts \}\);/);
    expect(app).toMatch(/\(\$\{ownerAccountName\(i\.gl_name\)\}\)/);
  });
});

describe("C712 — the recategorize card names what gets written", () => {
  const chart = [{ code: "6600", name: "Office Supplies" }];
  const L = [{ id: "x", vendor: "Adobe", amount: 59, gl_code: "6500", date: "2026-11-01", status: "posted" }];
  it("the chart's name for the code, not the model's label", () => {
    expect(describeDestructiveAction({ type: "recode", invoiceIds: ["x"], gl_code: "6600", gl_name: "Software" }, { invoices: L, chart }).description).toBe("Recategorize 1 transaction to Office Supplies.");
  });
  it("a code not on the chart is said, and the executor refuses it", () => {
    expect(describeDestructiveAction({ type: "recode", invoiceIds: ["x"], gl_code: "6999", gl_name: "New Thing" }, { invoices: L, chart }).description).toMatch(/no category numbered 6999 on your chart — nothing will be changed/);
    expect(readFileSync("src/App.jsx", "utf8")).toMatch(/if \(!chartAcct\) \{/);
  });
});

describe("C712 — a cut-off reply never shows raw JSON", () => {
  it("unterminated reply → the text, unescaped, with an ellipsis", () => {
    const r = parseAIReply('{"reply":"Here is your \\"cash\\" summary: you have $5,000 and the rest is');
    expect(r.reply).not.toMatch(/^\{"reply"/);
    expect(r.reply).toMatch(/^Here is your "cash" summary/);
    expect(r.reply).toMatch(/…$/);
  });
  it("a normal reply is unchanged", () => {
    expect(parseAIReply('{"reply":"Line one\\nLine two","actions":[]}').reply).toBe("Line one\nLine two");
  });
});
