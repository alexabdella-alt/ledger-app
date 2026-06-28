import { describe, it, expect } from "vitest";
import { buildDeferredRevenueReceiptEntry, buildArInvoiceEntry } from "../src/lib/revenueEntries.js";

const CASH = "1000", DEF = "2300", AR = "1100", REV = "4000", TAX = "2350";
const sumD = ls => ls.reduce((s, l) => s + (l.debit || 0), 0);
const sumC = ls => ls.reduce((s, l) => s + (l.credit || 0), 0);

describe("buildDeferredRevenueReceiptEntry (#11) — Dr Cash / Cr Deferred Revenue", () => {
  it("books a balanced advance receipt", () => {
    const je = buildDeferredRevenueReceiptEntry({ amount: 1200, cashCode: CASH, deferredRevCode: DEF, date: "2026-06-01", vendor: "Acme" });
    expect(je.balanced).toBe(true);
    expect(je.description).toBe("Advance payment – Acme");
    expect(je.lines).toEqual([
      { code: CASH, name: null, debit: 1200, credit: 0, memo: null },
      { code: DEF, name: null, debit: 0, credit: 1200, memo: null },
    ]);
    expect(sumD(je.lines)).toBe(sumC(je.lines));
  });

  it("is a balance-sheet-only movement (no P&L line → net income unaffected)", () => {
    const je = buildDeferredRevenueReceiptEntry({ amount: 500, cashCode: CASH, deferredRevCode: DEF });
    const pl = c => ["4", "5", "6", "7", "8"].includes(String(c)[0]);
    expect(je.lines.some(l => pl(l.code))).toBe(false);   // cash (1xxx) + deferred rev (2xxx) only
  });

  it("rounds to cents", () => {
    const je = buildDeferredRevenueReceiptEntry({ amount: 0.1 + 0.2, cashCode: CASH, deferredRevCode: DEF });
    expect(je.totalDebit).toBe(0.3);
    expect(je.balanced).toBe(true);
  });

  it("returns null on invalid amount or missing accounts", () => {
    expect(buildDeferredRevenueReceiptEntry({ amount: 0, cashCode: CASH, deferredRevCode: DEF })).toBe(null);
    expect(buildDeferredRevenueReceiptEntry({ amount: 100, cashCode: CASH })).toBe(null);
    expect(buildDeferredRevenueReceiptEntry({ amount: 100, deferredRevCode: DEF })).toBe(null);
  });
});

describe("buildArInvoiceEntry (#4/#16) — Dr A/R / Cr Revenue [/ Cr Sales Tax Payable]", () => {
  it("with a blended rate: 3-line, A/R = subtotal+tax, revenue ex-tax, tax to 2350", () => {
    const je = buildArInvoiceEntry({ subtotal: 1000, taxRate: 0.085, arCode: AR, revenueCode: REV, salesTaxCode: TAX, date: "2026-06-01", customer: "Acme", invoiceNumber: "INV-1" });
    expect(je.balanced).toBe(true);
    expect(je.lines).toEqual([
      { code: AR, name: null, debit: 1085, credit: 0, memo: null },     // Dr A/R full amount owed
      { code: REV, name: null, debit: 0, credit: 1000, memo: null },    // Cr Revenue ex-tax
      { code: TAX, name: null, debit: 0, credit: 85, memo: null },      // Cr Sales Tax Payable
    ]);
    expect(sumD(je.lines)).toBe(sumC(je.lines));
    expect(je.meta.tax).toBe(85);
    expect(je.meta.payment_status).toBe("uncollected");
  });

  it("sales tax is a LIABILITY (2xxx), never revenue — only the revenue line is 4xxx", () => {
    const je = buildArInvoiceEntry({ subtotal: 1000, taxRate: 0.085, arCode: AR, revenueCode: REV, salesTaxCode: TAX });
    const revenueLines = je.lines.filter(l => String(l.code)[0] === "4");
    expect(revenueLines).toEqual([{ code: REV, name: null, debit: 0, credit: 1000, memo: null }]);  // tax NOT counted as revenue
    expect(je.lines.find(l => l.code === TAX).code[0]).toBe("2");
  });

  it("tax = 0 → clean 2-line Dr A/R / Cr Revenue (backward compatible, no tax line)", () => {
    const je = buildArInvoiceEntry({ subtotal: 750, taxRate: 0, arCode: AR, revenueCode: REV, salesTaxCode: TAX });
    expect(je.lines).toHaveLength(2);
    expect(je.lines).toEqual([
      { code: AR, name: null, debit: 750, credit: 0, memo: null },
      { code: REV, name: null, debit: 0, credit: 750, memo: null },
    ]);
  });

  it("explicit taxAmount overrides the rate; rounds to cents", () => {
    const je = buildArInvoiceEntry({ subtotal: 100, taxAmount: 7.005, arCode: AR, revenueCode: REV, salesTaxCode: TAX });
    expect(je.lines[2]).toEqual({ code: TAX, name: null, debit: 0, credit: 7.01, memo: null });
    expect(je.lines[0].debit).toBe(107.01);
  });

  it("returns null on bad inputs (no subtotal, no A/R/revenue, or tax with no tax account)", () => {
    expect(buildArInvoiceEntry({ subtotal: 0, arCode: AR, revenueCode: REV })).toBe(null);
    expect(buildArInvoiceEntry({ subtotal: 100, revenueCode: REV })).toBe(null);
    expect(buildArInvoiceEntry({ subtotal: 100, taxRate: 0.08, arCode: AR, revenueCode: REV })).toBe(null);  // tax but no salesTaxCode
  });

  // Shakedown: the Riverside invoice ($1,200 services + $84 tax @ 7% = $1,284) was
  // booked Dr A/R 1284 / Cr Revenue 1284 — lumping tax into revenue. This is the exact
  // split the uploaded-invoice path now produces (persistJournalEntry derives subtotal =
  // total − tax_amount, then books via this builder).
  it("Riverside: $1,284 total with $84 tax → Dr A/R 1284 / Cr Revenue 1200 / Cr 2350 84", () => {
    const total = 1284, tax = 84, subtotal = total - tax;
    const je = buildArInvoiceEntry({ subtotal, taxAmount: tax, arCode: AR, revenueCode: REV, salesTaxCode: TAX, customer: "Riverside" });
    expect(je.balanced).toBe(true);
    expect(je.lines).toEqual([
      { code: AR, name: null, debit: 1284, credit: 0, memo: null },
      { code: REV, name: null, debit: 0, credit: 1200, memo: null },
      { code: TAX, name: null, debit: 0, credit: 84, memo: null },
    ]);
    expect(je.lines.find(l => l.code === REV).credit).toBe(1200);   // revenue is NET of tax, not 1284
  });
});
