import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { collapseExpandedRows, listAmount, classifyTxn } from "../src/lib/txnPresent.js";
import { renderViewHtml } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import BooksView from "../src/components/views/BooksView.jsx";

// ═════════════════════════════════════════════════════════════════════════════
// C503 — THE TRANSACTIONS LIST SHOWED A TAXED INVOICE AS THREE ROWS. Flatten expands a
// multi-line entry per line for the P&L; the owner's list rendered every line — an A/R row
// with no amount, "Sales +$1,200 · Open", "Sales Tax Payable −$99 · Paid" — and a two-line
// bill as three rows with two Mark Paid buttons. One row per entry now, at the entry's total.
// ═════════════════════════════════════════════════════════════════════════════
const chart = [
  { code: "1000", name: "Cash", category: "Assets", system_role: "cash" }, { code: "1100", name: "Accounts Receivable", category: "Assets", system_role: "accounts_receivable" },
  { code: "2000", name: "Accounts Payable", category: "Liabilities", system_role: "accounts_payable" }, { code: "2350", name: "Sales Tax Payable", category: "Liabilities" },
  { code: "4000", name: "Sales", category: "Revenue" }, { code: "5010", name: "Food Cost", category: "Expenses" }, { code: "5030", name: "Freight", category: "Expenses" },
];
const acct = (code) => ({ code, name: chart.find((a) => a.code === code)?.name });
const je = (id, date, description, lines, extra = {}) => ({ id, entry_date: date, description, status: "posted", deleted_at: null, source: "universal_upload",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: acct(l.code) })), ...extra });
const rows = flattenJournalEntries([
  je("s1", "2026-09-04", "Acme – catering", [{ code: "1100", debit: 1299 }, { code: "4000", credit: 1200 }, { code: "2350", credit: 99 }], { payment_status: "unpaid" }),
  je("b1", "2026-09-02", "Sysco – produce + freight", [{ code: "5010", debit: 500 }, { code: "5030", debit: 20 }, { code: "2000", credit: 520 }], { payment_status: "unpaid" }),
  je("b2", "2026-09-03", "Roma – cheese", [{ code: "5010", debit: 120 }, { code: "2000", credit: 120 }], { payment_status: "unpaid" }),
], chart);
const text = (h) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const ctx = { ...POPULATED, invoices: rows, companyDataLoaded: true, getAccountByRole: (r) => chart.find((a) => a.system_role === r) || null };

describe("C503", () => {
  it("collapses an expanded entry to one row — the revenue row for an invoice, the first P&L row for a bill — at the entry's total", () => {
    const c = collapseExpandedRows(rows);
    expect(c.map((r) => [r.id, listAmount(r), r._lineCount || 1])).toEqual([["s1_1", 1299, 3], ["b1_0", 520, 3], ["b2", 120, 1]]);
    const cls = classifyTxn(c[0], { apCode: "2000", arCode: "1100" });
    expect(cls.settleAction).toBe("collect");
    expect(classifyTxn(c[1], { apCode: "2000", arCode: "1100" }).settleAction).toBe("pay");
  });
  it("the Transactions list renders the taxed invoice once, at $1,299, with no Sales Tax row and one Mark Received", () => {
    const t = text(renderViewHtml(BooksView, ctx));
    expect((t.match(/Acme – catering/g) || []).length).toBe(1);
    expect(t).toContain("$1,299.00");
    expect(t).not.toContain("Sales Tax Payable");
    expect((t.match(/Mark Received/g) || []).length).toBe(1);
    expect((t.match(/Sysco – produce \+ freight/g) || []).length).toBe(1);
    expect(t).toContain("$520.00");
    expect(t).toContain("3 lines");
  });
  it("Mark Paid from an expanded row settles through the entry's leg row", () => {
    const src = fs.readFileSync("src/App.jsx", "utf8").replace(/^[ \t]*\/\/.*$/gm, "");
    const i = src.indexOf("const payEntry = buildPaymentEntry(legRow || inv, side, {");
    expect(i).toBeGreaterThan(-1);
    const j = src.lastIndexOf("const legRow = String(inv.id", i);
    expect(j).toBeGreaterThan(-1);
    expect(i - j).toBeLessThan(600);
  });
});

import { entryTotalOf, entryLineCount } from "../src/lib/txnPresent.js";
describe("C503 · the detail panel", () => {
  it("headlines the entry's total for a row of an expanded entry (the panel is a portal — pinned in source)", () => {
    const rev = rows.find((r) => r.id === "s1_1");
    expect(entryTotalOf(rev, rows)).toBe(1299);
    expect(entryLineCount(rev, rows)).toBe(3);
    expect(entryTotalOf(rows.find((r) => r.id === "b2"), rows)).toBe(120);
    const src = fs.readFileSync("src/components/TransactionDetailPanel.jsx", "utf8").replace(/^[ \t]*\/\/.*$/gm, "");
    expect(src).toMatch(/\{fmtM\(entryTotalOf\(sel, invoices\)\)\}/);
    expect(src).not.toMatch(/\{fmtM\(sel\.amount\)\}<\/div>/);
  });
});
