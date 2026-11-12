import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { planInvoiceArrival, withPaymentClaimed, hasAttachedInvoice, ARRIVAL } from "../src/lib/invoicePayment.js";
import { DIRECTORY_SEED } from "../src/lib/vendorDirectory.js";

// C622 — review finding U3: one payment absorbed several invoices; the second was never booked.
const ctx = { cashCodes: ["1000"], directory: DIRECTORY_SEED };
const payment = { id: "pay1", db_entry_id: "pay1", status: "posted", deleted_at: null, description: "Roma Cheese & Dairy Co – ACH DEBIT - ROMA CHEESE & DAIRY CO",
  source: "bank_import", amount: 534.8, date: "2026-08-04", gl_code: "5000", secondary_gl_code: "1000" };
const inv = (n) => ({ id: `i${n}`, vendor: "Roma Cheese & Dairy Co.", amount: 534.8, date: "2026-08-04", invoice_number: `R-${n}`, source: "universal_upload" });

describe("a payment can be claimed by one invoice", () => {
  it("the first invoice attaches", () => {
    expect(planInvoiceArrival(inv(1), [payment], ctx).action).toBe(ARRIVAL.ATTACH);
  });

  it("★ once claimed, the second identical invoice does NOT attach to the same payment", () => {
    const after = withPaymentClaimed([payment], "pay1");
    expect(hasAttachedInvoice(after[0])).toBe(true);
    expect(planInvoiceArrival(inv(2), after, ctx).action).not.toBe(ARRIVAL.ATTACH);
  });

  it("claiming marks a copy; the original rows are untouched", () => {
    const rows = [payment];
    withPaymentClaimed(rows, "pay1", "R-1");
    expect(rows[0].import_metadata).toBeUndefined();
  });

  it("★ the upload claims inside the loop and records the claim in the session's ledger after the stamp", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/const arrival = planInvoiceArrival\(invoice, arrivalLedger, \{/);
    expect(app).toMatch(/attachPlans\.push\(\{ invoice, target: arrival\.candidate\.entry, arrival \}\);\s*\n\s*claimPayment\(arrival\.candidate\.entry\);/);
    expect(app).toMatch(/invoicesRef\.current = markAttached\(invoicesRef\.current\);\s*\n\s*setInvoices\(prev => markAttached\(prev\)\);/);
  });
});
