import { describe, it, expect } from "vitest";
import fs from "node:fs";
// C437 — the customer's email said the pre-tax subtotal as the amount due while the invoice
// showed the taxed total. The email reads `total` and itemises the tax when there is one.
const src = fs.readFileSync("src/components/views/SendInvoiceView.jsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
describe("C437", () => {
  it("the email's amount and 'Total due' both read the taxed total", () => {
    const i = src.indexOf("const body = `Hi ${inv.customer}");
    const body = src.slice(i, src.indexOf(";", i));
    expect(body).toMatch(/for \$\{fmt\(total\)\}, due/);
    expect(body).toMatch(/Total due: \$\{fmt\(total\)\}/);
    expect(body).not.toMatch(/Total due: \$\{fmt\(subtotal\)\}/);
    expect(body).toMatch(/Subtotal: \$\{fmt\(subtotal\)\}\$\{taxLine\}/);
  });
  it("the audit row and the invoice HTML agree on the total", () => {
    expect(src).toMatch(/logAudit\("invoice_sent", `Invoice \$\{inv\.invoice_number\} sent to \$\{inv\.customer\} — \$\{fmt\(total\)\}/);
    expect(src).toMatch(/<span>Total Due<\/span><span>\$\{fmtMoney\(total\)\}<\/span>/);
  });
});
