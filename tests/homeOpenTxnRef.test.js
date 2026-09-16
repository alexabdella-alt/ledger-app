import { describe, it, expect } from "vitest";
import fs from "node:fs";
// C508 — Home's "View transaction →" on an unusual-activity card matched `i.id` alone; a stored
// ref is the entry's db id (C307), and an expanded entry's rows carry that on `db_entry_id`
// with `_n` ids of their own — so the card's door fell through to the unfiltered list. The
// bell's door and Review's evidence resolver already indexed both; Home now does.
describe("C508", () => {
  it("openTxn resolves a ref by id OR db_entry_id, like the bell door", () => {
    const src = fs.readFileSync("src/components/views/DashboardView.jsx", "utf8");
    expect(src).toMatch(/const openTxn = \(a\) => \{ const want=String\(\(a\.invoice_ids\|\|\[\]\)\[0\]\); const inv=\(invoices\|\|\[\]\)\.find\(i=>String\(i\.id\)===want \|\| String\(i\.db_entry_id\)===want\);/);
  });
});
