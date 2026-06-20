import { describe, it, expect } from "vitest";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { glAccountBalance, computeRevenue, computeAR, agingReport, owedAmount } from "../src/lib/reports.js";
import { buildArInvoiceEntry } from "../src/lib/revenueEntries.js";
import { buildPaymentEntry } from "../src/lib/payments.js";

// ════════════════════════════════════════════════════════════════════════════
// Taxed AR invoice — full lifecycle through the REAL flatten/reports/collection
// path. Proves a taxed invoice ages and collects on the FULL incl-tax A/R (so the
// tax is never stranded), revenue stays ex-tax, and the sales-tax liability (2350)
// is untouched by collection (it stays payable until remitted to the state).
// ════════════════════════════════════════════════════════════════════════════

const AR = "1100", REV = "4000", TAX = "2350", CASH = "1000";
const COA = [
  { code: AR, system_role: "accounts_receivable", category: "Assets" },
  { code: REV, category: "Revenue" },
  { code: TAX, category: "Liabilities" },
  { code: CASH, system_role: "cash", category: "Assets" },
];

// Issue: $1,000 + 8.5% tax = $85 → A/R $1,085, via the real builder, stored DB-shape.
const je = buildArInvoiceEntry({ subtotal: 1000, taxRate: 0.085, arCode: AR, revenueCode: REV, salesTaxCode: TAX, date: "2026-06-01", customer: "Acme", invoiceNumber: "INV-1", dueDate: "2026-07-01" });
const dbEntry = {
  id: "arje1", entry_date: "2026-06-01", description: "Acme – Invoice INV-1",
  source: "ar_invoice", status: "posted", deleted_at: null, created_at: "2026-06-01T10:00:00Z",
  payment_status: "uncollected", due_date: "2026-07-01",
  journal_entry_lines: je.lines.map(l => ({ debit: l.debit, credit: l.credit, accounts: { code: l.code, name: l.code } })),
};

describe("taxed AR invoice — issued", () => {
  const flat = flattenJournalEntries([dbEntry], COA);
  const revRow = flat.find(r => r.gl_code === REV);

  it("GL: A/R 1085 (incl tax), Revenue 1000 (ex tax), Sales Tax Payable 85", () => {
    expect(glAccountBalance(AR, flat)).toBe(1085);
    expect(glAccountBalance(REV, flat)).toBe(1000);
    expect(glAccountBalance(TAX, flat)).toBe(85);
  });
  it("revenue is ex-tax; the receivable row carries ar_amount = full incl-tax", () => {
    expect(computeRevenue(flat)).toBe(1000);       // P&L unaffected by tax
    expect(revRow.amount).toBe(1000);              // revenue leg ex-tax
    expect(revRow.ar_amount).toBe(1085);           // receivable owed incl-tax
    expect(owedAmount(revRow)).toBe(1085);
  });
  it("AR total and aging show the full $1,085 — and TIE to GL A/R", () => {
    expect(computeAR(flat).total).toBe(1085);
    expect(computeAR(flat).total).toBe(glAccountBalance(AR, flat));   // the two numbers tie
    expect(agingReport(flat, "ar").total).toBe(1085);
  });
});

describe("taxed AR invoice — collected", () => {
  const flat = flattenJournalEntries([dbEntry], COA);
  const revRow = flat.find(r => r.gl_code === REV);

  // Collect via the canonical AR payment builder.
  const pay = buildPaymentEntry(revRow, "ar", { apCode: "2000", accruedCode: "2100", arCode: AR, cashCode: CASH, cashName: "Cash", date: "2026-06-15", billDbId: "arje1" });

  it("collection clears the FULL incl-tax A/R: Dr Cash 1085 / Cr A/R 1085", () => {
    expect(pay.amount).toBe(1085);                 // not 1000 — tax not stranded
    expect(pay.gl_code).toBe(CASH);                // Dr Cash
    expect(pay.secondary_gl_code).toBe(AR);        // Cr A/R
    expect(pay.debit_credit).toBe("debit");
  });

  it("after collection: A/R → 0, Cash 1085, Sales Tax Payable still 85 (untouched)", () => {
    const payRow = { id: "col1", date: "2026-06-15", amount: pay.amount, debit_credit: pay.debit_credit, gl_code: pay.gl_code, secondary_gl_code: pay.secondary_gl_code, status: "booked" };
    // The invoice's rows flip to collected (shared JE payment_status); the payment posts.
    const after = [...flat.map(r => ({ ...r, payment_status: "collected" })), payRow];
    expect(glAccountBalance(AR, after)).toBe(0);     // fully relieved — no $85 stranded
    expect(glAccountBalance(CASH, after)).toBe(1085);
    expect(glAccountBalance(TAX, after)).toBe(85);   // liability untouched by collection
    expect(computeRevenue(after)).toBe(1000);        // revenue unchanged
    expect(agingReport(after, "ar").total).toBe(0);  // nothing open
    expect(computeAR(after).total).toBe(0);
  });
});
