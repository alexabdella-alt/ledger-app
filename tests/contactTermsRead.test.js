import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { buildUploadedInvoice } from "../src/lib/uploadedInvoice.js";
import { customerDefaultsFor, INVOICE_TERM_OPTIONS } from "../src/lib/invoiceDraft.js";

// ═════════════════════════════════════════════════════════════════════════════
// C473 — "PAYMENT TERMS" ON THE VENDORS AND CUSTOMERS FORMS WAS TYPED, SAVED, DISPLAYED,
// AND READ BY NOTHING. A bill whose document did not print its terms got no due date, so
// "Bills to pay" could never say it was overdue; an invoice to a Net-15 customer opened on
// Net 30 and a blank email. §9 "name the reader": the field has two now.
// ═════════════════════════════════════════════════════════════════════════════
const rc = (r) => ({ accounts_payable: "2000", accounts_receivable: "1100", miscellaneous_expense: "7100", product_revenue: "4000" })[r];
const rn = (r) => r;
const base = { coding: { gl_code: "5010", gl_name: "Food Cost", confidence: 90 }, rc, rn, id: "x", bookedAt: "2026-09-15T00:00:00Z", today: "2026-09-15" };

describe("C473 · a bill takes the supplier's saved terms when the document states none", () => {
  const vendor = { name: "Sysco", payment_terms: "Net 15" };
  it("derives the due date from the contact's terms", () => {
    const { invoice } = buildUploadedInvoice({ ...base, extracted: { vendor: "Sysco", amount: 500, date: "2026-09-01" }, contact: vendor });
    expect(invoice.payment_terms).toBe("Net 15");
    expect(invoice.due_date).toBe("2026-09-16");
  });
  it("the document's own terms win", () => {
    const { invoice } = buildUploadedInvoice({ ...base, extracted: { vendor: "Sysco", amount: 500, date: "2026-09-01", payment_terms: "Net 30" }, contact: vendor });
    expect(invoice.payment_terms).toBe("Net 30");
    expect(invoice.due_date).toBe("2026-10-01");
  });
  it("no contact, no terms → no due date, as before", () => {
    const { invoice } = buildUploadedInvoice({ ...base, extracted: { vendor: "Sysco", amount: 500, date: "2026-09-01" } });
    expect(invoice.payment_terms).toBe("");
    expect(invoice.due_date).toBeNull();
  });
  it("the upload path hands the builder the matched contact", () => {
    const app = fs.readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/buildUploadedInvoice\(\{\s*extracted, coding, rule, rc, rn,\s*contact: findContactForName\(/);
  });
});

describe("C473 · the invoice draft takes the customer's saved terms and email", () => {
  it("maps stored terms onto the select's options and fills a blank email", () => {
    expect(customerDefaultsFor({ email: "a@b.co", payment_terms: "net 15" }, { terms: "Net 30", customer_email: "" })).toEqual({ customer_email: "a@b.co", terms: "Net 15" });
    expect(customerDefaultsFor({ payment_terms: "due on receipt" }, { terms: "Net 30" })).toEqual({ terms: "On Receipt" });
  });
  it("never overwrites a typed email, and leaves a term the select cannot express alone", () => {
    expect(customerDefaultsFor({ email: "a@b.co", payment_terms: "Net 45" }, { terms: "Net 30", customer_email: "typed@x.co" })).toEqual({});
    expect(customerDefaultsFor(null, {})).toEqual({});
  });
  it("the select reads the same option list", () => {
    const src = fs.readFileSync("src/components/views/SendInvoiceView.jsx", "utf8");
    expect(src).toMatch(/INVOICE_TERM_OPTIONS\.map\(t=><option/);
    expect(src).toMatch(/customerDefaultsFor\(c, d\)/);
    expect(INVOICE_TERM_OPTIONS).toEqual(["On Receipt", "Net 15", "Net 30", "Net 60", "Net 90"]);
  });
});

// C475 — the customer's saved mailing address goes on the invoice too, under BILL TO.
describe("C475 · the invoice carries the customer's address", () => {
  it("prefills from the contact and never overwrites a typed one", () => {
    expect(customerDefaultsFor({ mailing_address: "1 Main St, Austin TX" }, { terms: "Net 30" })).toEqual({ customer_address: "1 Main St, Austin TX" });
    expect(customerDefaultsFor({ mailing_address: "1 Main St" }, { terms: "Net 30", customer_address: "typed" })).toEqual({});
  });
  it("the printed template and the preview show it under Bill To", () => {
    const src = fs.readFileSync("src/components/views/SendInvoiceView.jsx", "utf8");
    expect(src).toMatch(/<strong>Bill To:<\/strong> \$\{esc\(draft\.customer\)\}\$\{draft\.customer_address \? `<br>\$\{esc\(draft\.customer_address\)\}` : ""\}/);
    expect(src).toMatch(/\{draft\.customer_address && <div[^>]*>\{draft\.customer_address\}<\/div>\}/);
  });
});
