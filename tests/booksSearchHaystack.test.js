import { describe, it, expect } from "vitest";
import fs from "node:fs";

// ═════════════════════════════════════════════════════════════════════════════
// C479 — THE TRANSACTIONS SEARCH DID NOT MATCH THE AMOUNT AS PRINTED. The haystack held
// `String(824.6)`, so typing "824.60" — the figure on the row — found nothing, and the
// invoice number (kept since C478) was not searchable at all. C346's rule: the search reads
// what the card shows.
// ═════════════════════════════════════════════════════════════════════════════
describe("C479", () => {
  it("the predicate reads the printed amount and the invoice number", () => {
    const src = fs.readFileSync("src/components/views/BooksView.jsx", "utf8");
    const start = src.indexOf("const filtered = collapseExpandedRows(byFilter).filter(");   // C503 — one row per entry, same predicate
    expect(start).toBeGreaterThan(-1);
    const pred = src.slice(start, src.indexOf(");", start));
    expect(pred).toMatch(/fmt\(i\.amount\)\.toLowerCase\(\)\.includes\(q\)/);
    expect(pred).toMatch(/\(i\.invoice_number\|\|""\)\.toLowerCase\(\)\.includes\(q\)/);
  });
});
