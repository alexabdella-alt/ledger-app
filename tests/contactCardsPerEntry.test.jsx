import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { renderViewHtml } from "./helpers/renderView.jsx";
import { POPULATED, ENTRIES as FIX_ENTRIES } from "./helpers/populatedFixture.js";
import VendorsView from "../src/components/views/VendorsView.jsx";
import CustomersView from "../src/components/views/CustomersView.jsx";
import { collapseExpandedRows } from "../src/lib/txnPresent.js";
import { owedAmount } from "../src/lib/reports.js";

// ═════════════════════════════════════════════════════════════════════════════
// C522 — THE VENDOR AND CUSTOMER CARDS LISTED A BILL'S LINES AS SEPARATE TRANSACTIONS, AND
// READ OPEN/PAID OFF THE ROW'S FLAG. A two-line $520 Sysco bill was "All transactions (2)"
// with two rows of $500 and $20; a purchase paid at the till (Dr Expense / Cr Cash, no
// payment_status) read "Open"; "Payment history" counted a paid bill once per line and never
// counted the till purchase. One row per entry now, status from the same open list the
// card's figures read (C453/C452).
// ═════════════════════════════════════════════════════════════════════════════
const chart = [
  { code: "1000", name: "Cash", category: "Assets", system_role: "cash" }, { code: "1100", name: "Accounts Receivable", category: "Assets", system_role: "accounts_receivable" },
  { code: "2000", name: "Accounts Payable", category: "Liabilities", system_role: "accounts_payable" }, { code: "2350", name: "Sales Tax Payable", category: "Liabilities" },
  { code: "4000", name: "Sales", category: "Revenue" }, { code: "5010", name: "Food Cost", category: "Expenses" }, { code: "5030", name: "Freight", category: "Expenses" },
];
const acct = (code) => ({ code, name: chart.find((a) => a.code === code)?.name });
const je = (id, date, description, lines, extra = {}) => ({ id, entry_date: date, description, status: "posted", deleted_at: null, source: "universal_upload",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: acct(l.code) })), ...extra });
const text = (h) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const byRole = (r) => chart.find((a) => a.system_role === r) || null;

describe("C522 — the Vendors card", () => {
  const rows = flattenJournalEntries([
    je("b1", "2026-09-03", "Sysco – produce + freight", [{ code: "5010", debit: 500 }, { code: "5030", debit: 20 }, { code: "2000", credit: 520 }], { payment_status: "unpaid", due_date: "2026-09-20" }),
    je("till", "2026-09-05", "Sysco – ice, paid by card", [{ code: "5010", debit: 40 }, { code: "1000", credit: 40 }]),
  ], chart);
  const sysco = { id: "c1", name: "Sysco", type: "vendor" };
  const ctx = { ...POPULATED, invoices: rows, contacts: [sysco], vendorsSelectedContact: sysco, companyDataLoaded: true, getAccountByRole: byRole };

  it("the shape under test: the two-line bill is three rows", () => {
    expect(rows.filter((r) => r.db_entry_id === "b1").length).toBe(3);
  });
  it("lists the two-line bill ONCE at $520 with a lines hint, and the till purchase as Paid, not Open", () => {
    const t = text(renderViewHtml(VendorsView, ctx));
    expect(t).toContain("All transactions (2)");
    expect(t).toContain("$520.00");
    expect(t).toContain("· 2 lines");   // the card lists the expense lines; the A/P leg is not one of them
    expect((t.match(/\$500\.00/g) || []).length).toBe(0);   // a line's share is not a transaction
    expect(t).toContain("Payment history (1)");             // the till purchase, once
    expect((t.match(/\bOpen\b/g) || []).length).toBe(1);     // the bill; the till purchase is Paid
  });
});

describe("C522 — the Customers card counts entries", () => {
  it("a taxed invoice (the shape both invoice builders produce: one revenue credit) is one transaction at its full amount", () => {
    const rows = flattenJournalEntries([
      je("inv", "2026-09-03", "Acme – catering", [{ code: "1100", debit: 1299 }, { code: "4000", credit: 1200 }, { code: "2350", credit: 99 }], { payment_status: "unpaid", due_date: "2026-10-03" }),
    ], chart);
    expect(rows.length).toBe(3);   // the shape under test: an expanded entry
    const revenueRows = rows.filter((r) => r.gl_code === "4000");
    // The customer detail is local state (SSR cannot select it), so the property is held on the
    // rows the card reads: collapsed, one entry, at the receivable's amount (incl. tax).
    const list = collapseExpandedRows(revenueRows);
    expect(list.length).toBe(1);
    expect(owedAmount(list[0])).toBe(1299);
    const t = text(renderViewHtml(CustomersView, { ...POPULATED, invoices: rows, contacts: [{ id: "k1", name: "Acme", type: "customer" }], companyDataLoaded: true, getAccountByRole: byRole }));
    expect(t).toContain("Acme");
  });
});

// The customer detail cannot be rendered by SSR (its selection is local state), so its wiring is
// held as structure: the table maps the COLLAPSED list, prints the receivable's amount, and reads
// open/collected off the open list rather than the row's flag.
describe("C522 — the Customers card's wiring", () => {
  it("maps cList, prints owedAmount, decides collected from the open list", () => {
    const src = fs.readFileSync("src/components/views/CustomersView.jsx", "utf8").replace(/\/\/.*$/gm, "");
    expect(src).toContain("const cList = collapseExpandedRows(cTxns);");
    expect(src).toContain("{cList.map((i,idx)=>{");
    expect(src).toContain("const collected = !openBases.has(baseOf(i));");
    expect(src).toContain("{fmt(owedAmount(i))}");
    expect(src).not.toMatch(/cTxns\.map\(/);
    expect(src).not.toMatch(/i\.payment_status==="collected"\|\|i\.payment_status==="paid"/);
  });
});

// C545 — "Billed this year" is the invoice total, tax included: the fixture's taxed $1,299 invoice
// read "BILLED YTD $2,700 · STILL OWED $1,299" (billed = the ex-tax revenue rows, $1,200 + $1,500).
describe("C545 — a customer's billed-this-year includes the tax billed", () => {
  it("reads $2,799.00 (a $1,500 deposit and a $1,299 taxed invoice), and a correction still subtracts", () => {
    const ENTRIES = FIX_ENTRIES;
    const t = text(renderViewHtml(CustomersView, { ...POPULATED, companyDataLoaded: true }));
    const i = t.indexOf("Corner Market Catering Contact");
    expect(t.slice(i, i + 200)).toMatch(/BILLED YTD \$2,799\.00 STILL OWED TO YOU \$1,299\.00/);
    // a correction of the taxed invoice subtracts the whole $1,299, not the $1,200 revenue share
    const rev = ENTRIES.find((e) => e.id === "i8");
    const reversal = { ...rev, id: "i8r", entry_date: "2026-03-19", description: "REVERSAL: " + rev.description, import_metadata: { kind: "reversal", reverses: "i8" }, journal_entry_lines: rev.journal_entry_lines.map((l, n) => ({ ...l, id: `i8r-l${n}`, debit: l.credit, credit: l.debit })) };
    const rows = flattenJournalEntries([...ENTRIES, reversal], POPULATED.CHART_OF_ACCOUNTS);
    const t2 = text(renderViewHtml(CustomersView, { ...POPULATED, invoices: rows, companyDataLoaded: true }));
    const j = t2.indexOf("Corner Market Catering Contact");
    expect(t2.slice(j, j + 200)).toMatch(/BILLED YTD \$1,500\.00/);
  });
});
