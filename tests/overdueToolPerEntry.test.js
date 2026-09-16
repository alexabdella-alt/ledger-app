import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { executeAITool } from "../src/lib/aiTools.js";
import { perEntry } from "../src/lib/txnPresent.js";

// C532 — the chat's overdue list and the sidebar's "Bills to pay" badge count BILLS, not lines.
const chart = [
  { code: "1000", name: "Cash", category: "Assets", system_role: "cash" }, { code: "1100", name: "Accounts Receivable", category: "Assets", system_role: "accounts_receivable" },
  { code: "2000", name: "Accounts Payable", category: "Liabilities", system_role: "accounts_payable" }, { code: "5010", name: "Food Cost", category: "Expenses" }, { code: "5030", name: "Freight", category: "Expenses" },
];
const acct = (code) => ({ code, name: chart.find(a => a.code === code)?.name });
const je = (id, date, description, lines, extra = {}) => ({ id, entry_date: date, description, status: "posted", deleted_at: null, source: "universal_upload",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: acct(l.code) })), ...extra });
const rows = flattenJournalEntries([
  je("big", "2026-08-01", "Sysco – produce + freight", [{ code: "5010", debit: 3000 }, { code: "5030", debit: 3000 }, { code: "2000", credit: 6000 }], { payment_status: "unpaid", due_date: "2026-08-31" }),
  je("till", "2026-08-05", "Sysco – ice, paid by card", [{ code: "5010", debit: 40 }, { code: "1000", credit: 40 }]),
], chart);
const byRole = (r) => chart.find(a => a.system_role === r) || null;

describe("C532", () => {
  it("the overdue tool lists the two-line bill ONCE at $6,000 — and not the till purchase", async () => {
    const r = await executeAITool("get_overdue_invoices", { type: "ap" }, { getLedger: async () => rows, getAccountByRole: byRole, now: new Date("2026-09-15T12:00:00") });
    expect(r.count).toBe(1);
    expect(r.invoices[0].amount).toBe(6000);
    expect(r.total).toBe(6000);
  });
  it("without the company's codes, the flag list is still one per entry", async () => {
    const r = await executeAITool("get_overdue_invoices", { type: "ap" }, { getLedger: async () => rows, getAccountByRole: () => null, now: new Date("2026-09-15T12:00:00") });
    expect(r.invoices.filter(i => i.vendor === "Sysco" && i.amount === 6000)).toHaveLength(1);
  });
  it("perEntry's sentinel is the numeric line suffix — a fixture id with an underscore is a simple row", () => {
    const simple = [{ id: "ap_null", amount: 100 }, { id: "ap_paid", amount: 400 }];
    expect(perEntry(simple)).toEqual(simple);
    expect(perEntry(rows).filter(r => r.vendor === "Sysco").map(r => r.amount)).toEqual([6000, 40]);
  });
  it("the sidebar badge reads the code-aware one-per-bill list the Bills screen renders", () => {
    const src = fs.readFileSync("src/App.jsx", "utf8").replace(/\/\/.*$/gm, "");
    expect(src).toContain('const apUnpaid = openPayablesGL(invoices, rc("accounts_payable")).length;');
    expect(src).not.toMatch(/const apUnpaid = openPayables\(invoices\)/);
  });
});
