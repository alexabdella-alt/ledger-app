import { describe, it, expect } from "vitest";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { openReceivables, receivableEntries } from "../src/lib/receivables.js";
import { openReceivablesGL, computeAR, owedAmount, glAccountBalance } from "../src/lib/reports.js";
import { renderViewHtml } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import ArView from "../src/components/views/ArView.jsx";
import CustomersView from "../src/components/views/CustomersView.jsx";

// ═════════════════════════════════════════════════════════════════════════════
// C497 — A TAXED INVOICE ON TERMS WAS OWED THREE TIMES ON "MONEY OWED TO YOU" AND NOT AT
// ALL ON HOME. Send Invoice books `Dr A/R 1,299 / Cr Revenue 1,200 / Cr Sales Tax 99`
// (C267); flatten expands it to three rows, every one carrying A/R on a leg. C452's rule
// ("any row touching A/R") returned all three — $2,697 owed on a $1,299 invoice — and its
// fixtures were hand-made two-line rows, so the shape Send Invoice actually produces was
// never run. Home's `openReceivablesGL` ignored the offset on expanded rows and returned
// nothing. Run through the REAL flatten, with the chart, as production does.
// ═════════════════════════════════════════════════════════════════════════════
const chart = [
  { code: "1000", name: "Cash", category: "Assets", system_role: "cash" },
  { code: "1100", name: "Accounts Receivable", category: "Assets", system_role: "accounts_receivable" },
  { code: "2350", name: "Sales Tax Payable", category: "Liabilities", system_role: "sales_tax_payable" },
  { code: "4000", name: "Sales", category: "Revenue", system_role: "product_revenue" },
];
const acct = (code) => ({ code, name: chart.find((a) => a.code === code)?.name });
const je = (id, date, description, lines, extra = {}) => ({ id, entry_date: date, description, status: "posted", deleted_at: null, source: "ar_invoice",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: acct(l.code) })), ...extra });
const rows = flattenJournalEntries([
  je("s1", "2026-09-02", "Acme – catering", [{ code: "1100", debit: 1299 }, { code: "4000", credit: 1200 }, { code: "2350", credit: 99 }], { payment_status: "unpaid", due_date: "2026-10-02" }),
  je("s2", "2026-09-03", "Walk-in", [{ code: "1000", debit: 400 }, { code: "4000", credit: 400 }], { payment_status: "paid" }),
  je("s3", "2026-09-04", "Beta – design", [{ code: "1100", debit: 700 }, { code: "4000", credit: 700 }], { payment_status: "unpaid", due_date: "2026-10-04" }),
], chart);
const sum = (list) => list.reduce((s, i) => s + owedAmount(i), 0);
const text = (h) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("C497", () => {
  it("the shipped rule counted a taxed invoice three times — demonstrated on the real flatten", () => {
    const anyLeg = rows.filter((i) => String(i.gl_code) === "1100" || String(i.secondary_gl_code) === "1100").filter((i) => i.id.startsWith("s1"));
    expect(anyLeg).toHaveLength(3);
    expect(sum(anyLeg)).toBe(2697);
  });
  it("openReceivables: one row per invoice, the taxed receivable, and the same total as the A/R balance", () => {
    const open = openReceivables(rows, "1100");
    expect(open.map((i) => i.id)).toEqual(["s1_1", "s3"]);
    expect(sum(open)).toBe(1999);
    expect(glAccountBalance("1100", rows)).toBe(1999);
    expect(receivableEntries(rows, "1100")).toHaveLength(2);
  });
  it("Home's GL list and the KPI/monthly figure read the same rows", () => {
    expect(openReceivablesGL(rows, "1100").map((i) => i.id)).toEqual(["s1_1", "s3"]);
    expect(computeAR(rows, { now: new Date("2026-09-15T12:00:00"), arCode: "1100" }).total).toBe(1999);
  });
  it("Money owed to you lists the taxed invoice once and totals $1,999.00", () => {
    const t = text(renderViewHtml(ArView, { ...POPULATED, invoices: rows, companyDataLoaded: true, getAccountByRole: (r) => chart.find((a) => a.system_role === r) || null }));
    expect(t).toContain("$1,999.00");
    expect(t).not.toContain("$2,697.00");
    expect((t.match(/Acme/g) || []).length).toBeLessThanOrEqual(2);   // the row (and at most a customer chip) — not three rows
  });
  it("the Customers screen's still-owed is the receivable, not three of them", () => {
    const t = text(renderViewHtml(CustomersView, { ...POPULATED, invoices: rows, contacts: [], companyDataLoaded: true, getAccountByRole: (r) => chart.find((a) => a.system_role === r) || null }));
    expect(t).not.toContain("$2,697.00");
    expect(t).toContain("$1,299.00");
  });
});
