import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { canMarkInvoicePaid } from "../src/lib/invoiceMarkPaid";

// C593 — review finding F5: "Mark paid" on a DRAFT invoice booked cash and income, saved
// nothing, and could be clicked again after a reload.
describe("which invoices can be marked paid", () => {
  it.each([["sent", true], ["partial", true], ["overdue", true], ["draft", false], ["", false], ["void", false], ["paid", false]])("%s → %s", (status, ok) => {
    expect(canMarkInvoicePaid({ invoice_number: "INV-0007", status }).ok).toBe(ok);
  });

  it("a voided invoice says it was voided, not that it is a draft", () => {
    expect(canMarkInvoicePaid({ invoice_number: "INV-0007", status: "void" }).why).toBe("INV-0007 was voided, so there is nothing to collect.");
  });

  it("★ a draft says what to do instead", () => {
    expect(canMarkInvoicePaid({ invoice_number: "INV-0007", status: "draft" }).why)
      .toBe("INV-0007 is still a draft — send it first; nothing is owed until it has been sent.");
  });
});

describe("the screen", () => {
  const src = readFileSync("src/components/views/SendInvoiceView.jsx", "utf8");
  const fn = src.slice(src.indexOf("const markInvoicePaid = async"), src.indexOf("// Professional on-screen invoice preview."));

  it("★ refuses before anything is written", () => {
    const gate = fn.indexOf("if (!can.ok) { showNotification(can.why, \"error\"); return; }");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(fn.indexOf("markBillPaid("));
    expect(gate).toBeLessThan(fn.indexOf("bookToDb("));
  });

  it("★ BOTH branches save the invoice as paid, after the books say so", () => {
    expect(fn.match(/await saveInvoicePaid\(\);/g)).toHaveLength(2);
    expect(fn.indexOf("await saveInvoicePaid();", fn.indexOf("bookToDb("))).toBeGreaterThan(fn.indexOf("if (!jeId) return;"));
    expect(fn).toMatch(/patch: \{ status: "paid", paid_at: new Date\(\)\.toISOString\(\) \}, label: "ar_invoice_paid"/);
  });

  it("★ offers the button only where it can work — the same rule as the click", () => {
    expect(src).toMatch(/\{canMarkInvoicePaid\(inv\)\.ok && \(\s*\n\s*<button data-mark-paid onClick=\{e=>\{e\.stopPropagation\(\);markInvoicePaid\(inv\);\}\}/);
    expect(src).not.toMatch(/inv\.status!=="paid" && \(\s*\n\s*<button/);
  });
});
