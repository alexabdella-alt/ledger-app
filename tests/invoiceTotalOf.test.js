import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { invoiceTotalOf } from "../src/lib/invoiceDraft.js";
// C438 — a sent invoice's amount includes its sales tax, in the list and on the legacy mark-paid path.
describe("C438", () => {
  it("sums the lines and adds the tax, to the cent", () => {
    expect(invoiceTotalOf({ line_items: [{ amount: 1000 }, { amount: 200 }], tax_amount: 99 })).toBe(1299);
    expect(invoiceTotalOf({ line_items: [{ amount: 33.335 }], tax_amount: 0 })).toBe(33.34);
    expect(invoiceTotalOf({})).toBe(0);
  });
  it("the list and the mark-paid path read it", () => {
    const src = fs.readFileSync("src/components/views/SendInvoiceView.jsx", "utf8");
    expect(src).toMatch(/const amt = invoiceTotalOf\(inv\);/);
    expect(src).toMatch(/const invTotal = invoiceTotalOf\(inv\);/);
    expect(src).not.toMatch(/inv\.line_items\?\.reduce\(\(s,l\)=>s\+\(l\.amount\|\|0\),0\)\|\|0;/);
  });
});
