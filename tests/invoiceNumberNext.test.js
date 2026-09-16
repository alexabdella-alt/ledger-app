import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { nextInvoiceNumber } from "../src/lib/invoiceDraft.js";
// C511 — `INV-${count+1}` reused a number after a failed persist, a removed invoice, or a
// custom-numbered one. One past the highest INV-number, never a count.
describe("C511", () => {
  it("one past the highest, whatever the count", () => {
    expect(nextInvoiceNumber([])).toBe("INV-0001");
    expect(nextInvoiceNumber([{ invoice_number: "INV-0001" }, { invoice_number: "INV-0003" }])).toBe("INV-0004");
    expect(nextInvoiceNumber([{ invoice_number: "ACME-7" }, { invoice_number: "INV-0012" }])).toBe("INV-0013");
    expect(nextInvoiceNumber([{ invoice_number: "INV-0001" }, { invoice_number: "INV-0002" }, { invoice_number: "INV-0002" }])).toBe("INV-0003");
  });
  it("demonstrated: the count gives INV-0003 twice when INV-0003 already exists after a gap", () => {
    const list = [{ invoice_number: "INV-0001" }, { invoice_number: "INV-0003" }];
    expect(`INV-${String(list.length + 1).padStart(4, "0")}`).toBe("INV-0003");
  });
  it("Send Invoice reads it", () => {
    const src = fs.readFileSync("src/components/views/SendInvoiceView.jsx", "utf8");
    expect(src).toMatch(/const nextNum = nextInvoiceNumber\(sentInvoices\);/);
    expect(src).not.toMatch(/sentInvoices\.length\+1/);
  });
});
