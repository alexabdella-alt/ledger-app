import { describe, it, expect } from "vitest";
import fs from "node:fs";
// C449 — the invoice and monthly-report documents are written into a NEW window with no
// stylesheet, so `var(--sc-*)` resolved to nothing there: the invoice number lost its colour,
// the table header its background, every row its border. Literal colours in print templates.
const between = (src, startMarker, endMarker) => { const i = src.indexOf(startMarker); return src.slice(i, src.indexOf(endMarker, i)); };
describe("C449", () => {
  it("the invoice document carries no CSS variable", () => {
    const src = fs.readFileSync("src/components/views/SendInvoiceView.jsx", "utf8");
    const html = between(src, "const html = `<!DOCTYPE html>", "</html>`");
    expect(html.length).toBeGreaterThan(500);
    expect(html).not.toMatch(/var\(--/);
    expect(html).toMatch(/th\{background:#111;color:#fff;/);   // and the header text is visible on its background
  });
  it("the printed monthly report carries no CSS variable", () => {
    const src = fs.readFileSync("src/components/views/MonthlyReportsPanel.jsx", "utf8");
    const html = between(src, "const html = `<!doctype html>", "</html>`");
    expect(html.length).toBeGreaterThan(500);
    expect(html).not.toMatch(/var\(--/);
    const row = src.slice(src.indexOf("const row = (name, c, p, ch, pc, bold) =>"), src.indexOf("const html = `<!doctype html>"));
    expect(row).not.toMatch(/var\(--/);
  });
});
