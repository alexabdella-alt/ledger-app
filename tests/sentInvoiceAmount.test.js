import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { sentInvoiceFromRow, arInvoiceRows } from "../src/lib/arInvoiceRows";

// C626 — review finding F8.
describe("a taxed invoice keeps its tax after a reload", () => {
  const row = { id: "x", invoice_number: "INV-0007", status: "sent", tax_amount: 86.25,
    ar_invoice_lines: [{ id: "l1", description: "Work", quantity: 1, unit_rate: 1000, amount: 1000, sort_order: 0 }] };

  it("★ the rate is restored from the stored tax", () => {
    expect(sentInvoiceFromRow(row).tax_rate).toBe("8.625");
  });

  it("★ and saving it again writes the same tax", () => {
    const inv = sentInvoiceFromRow(row);
    const taxAmount = Math.round(1000 * (parseFloat(inv.tax_rate) / 100) * 100) / 100;   // the editor's own formula
    expect(arInvoiceRows(inv, { companyId: "c", taxAmount }).header.tax_amount).toBe(86.25);
  });

  it("an untaxed invoice has no rate", () => {
    expect(sentInvoiceFromRow({ ...row, tax_amount: 0 }).tax_rate).toBe("");
  });
});

describe("a sent invoice's amount", () => {
  it("★ cannot be changed by re-sending; the same invoice can be re-sent", () => {
    const v = readFileSync("src/components/views/SendInvoiceView.jsx", "utf8");
    const fn = v.slice(v.indexOf("const sendInvoiceOnce = async"), v.indexOf("const downloadPDF = "));
    // C717 — against the books (bookedInvoiceFacts → sentInvoiceChangeProblem), the screen's copy only if the entry isn't loaded
    expect(fn).toMatch(/const problem = bookedProblem \|\| \(!booked && before \? sentInvoiceChangeProblem\(draft, total, \{ total: invoiceTotalOf\(before\), date: before\.issue_date \}\) : null\);\s*if \(problem\) \{ showNotification\(problem, "error"\); return; \}/);
    expect(fn).not.toMatch(/setInvoices\(prev => prev\.map\(e => String\(e\.id\)===String\(inv\.ledger_id\)/);
  });
});
