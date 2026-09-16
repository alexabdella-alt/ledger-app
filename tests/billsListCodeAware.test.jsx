import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { openPayablesGL, paidPayablesGL, computeAP, glAccountBalance } from "../src/lib/reports.js";
import { renderViewHtml } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import ApView from "../src/components/views/ApView.jsx";

// ═════════════════════════════════════════════════════════════════════════════
// C513 — A CAPITALIZED PURCHASE ON TERMS WAS IN "YOU OWE" AND ON NO BILL LIST. C309 made
// `computeAP` count `Dr Equipment / Cr A/P` (the live Sabine bill) with the company's A/P
// code; `openPayablesGL` called the code-less predicate inside, and the Bills screen read the
// flag list — so Home's card, the Vendors tab and the Bills screen all missed a $4,625 bill
// that the health block, the control total and the monthly report counted. And the Bills
// screen showed a two-line bill as two bills with two Mark as Paid buttons.
// ═════════════════════════════════════════════════════════════════════════════
const chart = [
  { code: "1000", name: "Cash", category: "Assets", system_role: "cash" }, { code: "1500", name: "Equipment", category: "Assets" },
  { code: "2000", name: "Accounts Payable", category: "Liabilities", system_role: "accounts_payable" },
  { code: "5010", name: "Food Cost", category: "Expenses" }, { code: "5030", name: "Freight", category: "Expenses" },
];
const acct = (code) => ({ code, name: chart.find((a) => a.code === code)?.name });
const je = (id, date, description, lines, extra = {}) => ({ id, entry_date: date, description, status: "posted", deleted_at: null, source: "universal_upload",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: acct(l.code) })), ...extra });
const rows = flattenJournalEntries([
  je("sab", "2026-09-02", "Sabine – freezer", [{ code: "1500", debit: 4625 }, { code: "2000", credit: 4625 }], { payment_status: "unpaid", due_date: "2026-10-02" }),
  je("b1", "2026-09-03", "Sysco – produce + freight", [{ code: "5010", debit: 500 }, { code: "5030", debit: 20 }, { code: "2000", credit: 520 }], { payment_status: "unpaid", due_date: "2026-09-20" }),
  je("b2", "2026-09-04", "Roma – cheese", [{ code: "5010", debit: 120 }, { code: "2000", credit: 120 }], { payment_status: "paid", paid_at: "2026-09-10" }),
  je("p2", "2026-09-10", "Payment – Roma", [{ code: "2000", debit: 120 }, { code: "1000", credit: 120 }], { import_metadata: { kind: "ap_payment", payment_for: "b2" }, payment_status: "paid" }),
], chart);
const text = (h) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("C513", () => {
  it("the GL open list holds the capitalized purchase and one row per bill, and ties to the A/P balance and computeAP", () => {
    const open = openPayablesGL(rows, "2000");
    expect(open.map((r) => [r.vendor, r.amount])).toEqual([["Sabine", 4625], ["Sysco", 520]]);
    expect(open.reduce((s, r) => s + r.amount, 0)).toBe(glAccountBalance("2000", rows));
    expect(open.reduce((s, r) => s + r.amount, 0)).toBe(computeAP(rows, { apCode: "2000" }).total);
    const sysco = open.find((r) => r.vendor === "Sysco");
    expect([sysco.gl_code, sysco.gl_name, sysco._lineCount]).toEqual(["5010", "Food Cost", 3]);   // presented by its first expense line, not "2000 · Accounts Payable"
  });
  it("the paid list keeps one row per bill and its total counts a paid capitalized purchase", () => {
    const paidRows = flattenJournalEntries([je("sab2", "2026-08-02", "Sabine – oven", [{ code: "1500", debit: 900 }, { code: "2000", credit: 900 }], { payment_status: "paid" })], chart);
    const paid = paidPayablesGL([...rows, ...paidRows], "2000");
    expect(paid.map((r) => r.vendor)).toEqual(["Roma", "Sabine"]);
    expect(paid.reduce((s, r) => s + r.amount, 0)).toBe(1020);
  });
  it("the Bills screen lists the freezer, one Sysco row, and one Mark as Paid per bill", () => {
    const t = text(renderViewHtml(ApView, { ...POPULATED, invoices: rows, companyDataLoaded: true, getAccountByRole: (r) => chart.find((a) => a.system_role === r) || null }));
    expect(t).toContain("Sabine");
    expect(t).toContain("$4,625.00");
    expect(t).toContain("2 bills");
    expect((t.match(/Mark as Paid/g) || []).length).toBe(2);
    expect(t).toContain("$520.00");
    expect(t).not.toContain("$20.00");
    expect(t).not.toContain("Accounts Payable");
  });
});

import { agingReport } from "../src/lib/reports.js";
describe("C514 · the aging report's buckets sum to its GL headline", () => {
  it("with the A/P code the buckets hold the freezer and one row per bill; without, the flag rows as before", () => {
    const now = new Date("2026-09-15T12:00:00");
    const rep = agingReport(rows, "ap", now, { apCode: "2000" });
    expect(rep.total).toBe(glAccountBalance("2000", rows));
    expect(rep.count).toBe(2);
    const parties = rep.buckets.flatMap((b) => b.rows.map((r) => [r.party, r.amount]));
    expect(parties).toEqual(expect.arrayContaining([["Sabine", 4625], ["Sysco", 520]]));
    expect(parties).toHaveLength(2);
    const legacy = agingReport(rows, "ap", now);
    expect(legacy.total).toBe(520);   // the flag rows: two Sysco lines, no freezer — the old reading, kept only for a caller with no code
  });
});

describe("C514 · Reports passes the codes", () => {
  it("the aging call site hands both roles over", () => {
    const src = require("node:fs").readFileSync("src/components/views/ReportsView.jsx", "utf8");
    expect(src).toMatch(/agingReport\(invoices, side, new Date\(\), \{ arCode: getAccountByRole\?\.\("accounts_receivable"\)\?\.code \|\| null, apCode: getAccountByRole\?\.\("accounts_payable"\)\?\.code \|\| null \}\)/);
  });
});
