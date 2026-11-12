import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { draftForCustomer, draftHasWork, newInvoiceDraft } from "../src/lib/invoiceDraft.js";

const metro = { name: "Metro Cafe", email: "ap@metrocafe.com", mailing_address: "12 Main St", payment_terms: "Net 15" };

describe("C584 — 'Send an invoice' from a customer's page starts with that customer", () => {
  it("a fresh invoice carries their name, email, address and usual terms, and the next number", () => {
    const { draft, kept } = draftForCustomer(metro, { existingDraft: null, sentInvoices: [{ invoice_number: "INV-7" }], salesTaxRate: 8.25 });
    expect(kept).toBe(false);
    expect(draft).toMatchObject({ customer: "Metro Cafe", customer_email: "ap@metrocafe.com", customer_address: "12 Main St", terms: "Net 15", invoice_number: "INV-0008", tax_rate: "8.25" });
    expect(draft.line_items).toHaveLength(1);
  });
  it("a customer we know only by name still gets a complete draft", () => {
    const { draft } = draftForCustomer({ name: "Walk-in Co" });
    expect(draft.customer).toBe("Walk-in Co");
    expect(draft.customer_email).toBe("");
    expect(draft.terms).toBe("Net 30");
  });
  it("an empty in-progress draft is replaced — nothing is lost", () => {
    const empty = newInvoiceDraft({ invoiceNumber: "INV-3" });
    expect(draftHasWork(empty)).toBe(false);
    expect(draftForCustomer(metro, { existingDraft: empty }).kept).toBe(false);
  });
  it("★ an unfinished invoice for someone else is kept, and named", () => {
    const wip = { ...newInvoiceDraft({ invoiceNumber: "INV-3" }), customer: "Bright Co", line_items: [{ description: "Design", rate: "500", amount: 500 }] };
    const r = draftForCustomer(metro, { existingDraft: wip });
    expect(r.kept).toBe(true);
    expect(r.draft).toBe(wip);
    expect(r.keptFor).toBe("Bright Co");
  });
  it("an unfinished invoice for the SAME customer is kept quietly; work with no name yet is still work", () => {
    const wip = { ...newInvoiceDraft({}), customer: "metro cafe" };
    expect(draftForCustomer(metro, { existingDraft: wip })).toMatchObject({ kept: true, keptFor: null });
    const lineOnly = { ...newInvoiceDraft({}), line_items: [{ description: "Catering", rate: "", amount: 0 }] };
    expect(draftHasWork(lineOnly)).toBe(true);
    expect(draftForCustomer(metro, { existingDraft: lineOnly }).keptFor).toBe("another customer");
    // a line with only a price on it is work too
    expect(draftHasWork({ ...newInvoiceDraft({}), line_items: [{ description: "", rate: "250", amount: 0 }] })).toBe(true);
    expect(draftHasWork({ ...newInvoiceDraft({}), line_items: [{ description: "", rate: "", amount: 250 }] })).toBe(true);
  });
  it("the customer page's button goes through it, and only sets the draft when nothing was kept", () => {
    const src = readFileSync("src/components/views/CustomersView.jsx", "utf8");
    expect(src).toMatch(/const r = draftForCustomer\(c, \{ existingDraft: sendInvoiceDraftState, sentInvoices, salesTaxRate: companySettings\?\.salesTaxRate \}\);\s*if \(!r\.kept\) setSendInvoiceDraftState\(r\.draft\);/);
    expect(src).toMatch(/You have an unfinished invoice for \$\{r\.keptFor\}/);
  });
});
