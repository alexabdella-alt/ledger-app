import { describe, it, expect } from "vitest";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { renderViewHtml } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import ArView from "../src/components/views/ArView.jsx";

// C528 — "Money owed to you" decides COLLECTED from the open list (GL truth), not the row's flag.
// An invoice cleared by a collection entry whose flag write was lost read as still owed on the
// card and in the list while the aging and "still owed" said otherwise.
const chart = [
  { code: "1000", name: "Cash", category: "Assets", system_role: "cash" }, { code: "1100", name: "Accounts Receivable", category: "Assets", system_role: "accounts_receivable" },
  { code: "2000", name: "Accounts Payable", category: "Liabilities", system_role: "accounts_payable" }, { code: "4000", name: "Sales", category: "Revenue" },
];
const acct = (code) => ({ code, name: chart.find(a => a.code === code)?.name });
const je = (id, date, description, lines, extra = {}) => ({ id, entry_date: date, description, status: "posted", deleted_at: null, source: "ar_invoice",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: acct(l.code) })), ...extra });
const rows = flattenJournalEntries([
  je("inv1", "2026-08-01", "Acme – Invoice 1", [{ code: "1100", debit: 500 }, { code: "4000", credit: 500 }], { payment_status: "uncollected", due_date: "2026-08-31" }),
  // cleared by a real collection, but the flag write was lost — the row still says uncollected
  je("col1", "2026-08-20", "Collection – Acme", [{ code: "1000", debit: 500 }, { code: "1100", credit: 500 }], { source: "bank_import", import_metadata: { kind: "ar_collection", payment_for: "inv1" }, payment_status: "collected" }),
  je("inv2", "2026-09-01", "Bravo – Invoice 2", [{ code: "1100", debit: 300 }, { code: "4000", credit: 300 }], { payment_status: "uncollected", due_date: "2026-09-30" }),
], chart);
const text = (h) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("C528", () => {
  it("the cleared invoice is Collected and the open one is not — from the GL, with the flag still saying uncollected", () => {
    expect(rows.find(r => r.id === "inv1").payment_status).toBe("uncollected");   // the shape under test
    const t = text(renderViewHtml(ArView, { ...POPULATED, invoices: rows, companyDataLoaded: true, getAccountByRole: (r) => chart.find(a => a.system_role === r) || null }));
    expect(t).toMatch(/COLLECTED \(TOTAL\)\s*\$500\.00\s*1 invoices/);
    expect(t).toMatch(/TOTAL OUTSTANDING\s*\$300\.00/);
  });
});

// The same rule on every open list and total: a bill a LIVE payment links is not open, whatever
// its flag says — and a VOIDED payment links nothing.
import { openPayablesGL, paidPayablesGL, computeAP, computeAR, openReceivablesGL, agingReport } from "../src/lib/reports.js";
import { openReceivables } from "../src/lib/receivables.js";
import { computeControlTotals } from "../src/lib/controlTotals.js";

describe("C528 — linked-settled bills leave every open list", () => {
  const apRows = flattenJournalEntries([
    je("b1", "2026-08-01", "Sysco – bill", [{ code: "5010", debit: 400 }, { code: "2000", credit: 400 }], { source: "universal_upload", payment_status: "unpaid", due_date: "2026-08-31" }),
    je("p1", "2026-08-15", "Payment – Sysco", [{ code: "2000", debit: 400 }, { code: "1000", credit: 400 }], { source: "bank_import", import_metadata: { kind: "ap_payment", payment_for: "b1" }, payment_status: "paid" }),
    je("b2", "2026-09-01", "Roma – bill", [{ code: "5010", debit: 300 }, { code: "2000", credit: 300 }], { source: "universal_upload", payment_status: "unpaid", due_date: "2026-09-30" }),
    je("p2", "2026-09-05", "Payment – Roma", [{ code: "2000", debit: 300 }, { code: "1000", credit: 300 }], { source: "bank_import", import_metadata: { kind: "ap_payment", payment_for: "b2" }, payment_status: "paid", status: "voided" }),
  ], [...chart, { code: "5010", name: "Food Cost", category: "Expenses" }]);
  const codes = { ar: "1100", ap: "2000", salesTax: "2350" };
  it("b1 (paid, flag stale) is not open; b2 (its payment voided) still is", () => {
    expect(openPayablesGL(apRows, "2000").map(r => r.id)).toEqual(["b2"]);
    expect(paidPayablesGL(apRows, "2000").map(r => r.id)).toEqual(["b1"]);
    expect(computeAP(apRows, { apCode: "2000" }).total).toBe(300);
    expect(agingReport(apRows, "ap", new Date("2026-09-15"), { apCode: "2000" }).total).toBe(300);
  });
  it("and ap_tie ties on it", () => {
    const c = computeControlTotals({ invoices: apRows, reconciliations: [], intakeRows: [], codes }).checks.find(x => x.key === "ap_tie");
    expect([c.a, c.b, c.ties]).toEqual([300, 300, true]);
  });
  it("the A/R side: the cleared invoice is out of both open lists and the total, and ar_tie ties", () => {
    expect(openReceivables(rows, "1100").map(r => r.id)).toEqual(["inv2"]);
    expect(openReceivablesGL(rows, "1100").map(r => r.id)).toEqual(["inv2"]);
    expect(computeAR(rows, { arCode: "1100" }).total).toBe(300);
    const c = computeControlTotals({ invoices: rows, reconciliations: [], intakeRows: [], codes }).checks.find(x => x.key === "ar_tie");
    expect([c.a, c.b, c.ties]).toEqual([300, 300, true]);
  });
});

// And the settle button: a bill a live payment links gets no Mark as Paid (O124 — not offered,
// rather than refused on click), on the Transactions list and the panel's classifier.
import { classifyTxn } from "../src/lib/txnPresent.js";
import { settledBases } from "../src/lib/gl.js";
import BooksView from "../src/components/views/BooksView.jsx";
describe("C528 — no Mark as Paid on a linked-settled bill", () => {
  const apRows = flattenJournalEntries([
    je("b1", "2026-08-01", "Sysco – bill", [{ code: "5010", debit: 400 }, { code: "2000", credit: 400 }], { source: "universal_upload", payment_status: "unpaid" }),
    je("p1", "2026-08-15", "Payment – Sysco", [{ code: "2000", debit: 400 }, { code: "1000", credit: 400 }], { source: "bank_import", import_metadata: { kind: "ap_payment", payment_for: "b1" }, payment_status: "paid" }),
    je("b2", "2026-09-01", "Roma – bill", [{ code: "5010", debit: 300 }, { code: "2000", credit: 300 }], { source: "universal_upload", payment_status: "unpaid" }),
  ], [...chart, { code: "5010", name: "Food Cost", category: "Expenses" }]);
  const settled = settledBases(apRows);
  it("the classifier withholds the action with the ledger's settled set, and offers it without", () => {
    const b1 = apRows.find(r => r.id === "b1"), b2 = apRows.find(r => r.id === "b2");
    expect(classifyTxn(b1, { apCode: "2000", arCode: "1100", settled }).settleAction).toBeNull();
    expect(classifyTxn(b2, { apCode: "2000", arCode: "1100", settled }).settleAction).toBe("pay");
    expect(classifyTxn(b1, { apCode: "2000", arCode: "1100" }).settleAction).toBe("pay");   // the flag alone still says pay — which is why the set is threaded
  });
  it("the Transactions list renders one Mark as Paid, for the open bill", () => {
    const t = text(renderViewHtml(BooksView, { ...POPULATED, invoices: apRows, companyDataLoaded: true, getAccountByRole: (r) => [...chart, { code: "5010", name: "Food Cost", category: "Expenses" }].find(a => a.system_role === r) || null }));
    expect((t.match(/Mark Paid/g) || []).length).toBe(1);
  });
});
