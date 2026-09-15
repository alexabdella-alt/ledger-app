import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { invoiceDueLabel } from "../src/lib/invoiceDraft.js";
// C450 — the invoice read "Due Date: On Receipt · Terms: Net 30" by default.
describe("C450", () => {
  it("a typed due date wins; else the terms decide; On Receipt reads as on receipt", () => {
    expect(invoiceDueLabel({ issue_date: "2026-09-01", due_date: "2026-09-20", terms: "Net 30" })).toBe("2026-09-20");
    expect(invoiceDueLabel({ issue_date: "2026-09-01", due_date: "", terms: "Net 30" })).toBe("2026-10-01");
    expect(invoiceDueLabel({ issue_date: "2026-09-01", due_date: "", terms: "On Receipt" })).toBe("On receipt");
    expect(invoiceDueLabel({ issue_date: "", due_date: "", terms: "Net 30" })).toBe("On receipt");
    expect(invoiceDueLabel({ issue_date: "2026-09-01", due_date: "", terms: "Net 15" }, (d) => `[${d}]`)).toBe("[2026-09-16]");
  });
  it("the printed invoice, the preview and the email all read it, and the print shows Terms only when set", () => {
    const src = fs.readFileSync("src/components/views/SendInvoiceView.jsx", "utf8");
    expect(src).toMatch(/Due Date: \$\{esc\(invoiceDueLabel\(draft, fmtDate\)\)\}/);
    expect(src).toMatch(/Due date: <strong[^>]*>\{invoiceDueLabel\(draft, fmtDate\)\}/);
    expect(src).toMatch(/due \$\{invoiceDueLabel\(inv, fmtDate\)/);
    expect(src).toMatch(/\$\{draft\.terms \? `Terms: \$\{esc\(draft\.terms\)\}` : ""\}/);
    expect(src).not.toMatch(/Terms: \$\{esc\(draft\.terms\|\|"Net 30"\)\}/);
    expect(src).toMatch(/Issue Date: \$\{esc\(draft\.issue_date \? fmtDate\(draft\.issue_date\) : ""\)\}/);
  });
});
