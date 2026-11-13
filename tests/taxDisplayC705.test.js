// C705 — smaller display fixes from the whole-tax-area review.
import { describe, it, expect } from "vitest";
import { taxPacketRows } from "../src/lib/taxPacket.js";
import { readFileSync } from "node:fs";

const tax = readFileSync("src/components/views/TaxView.jsx", "utf8");
describe("C705", () => {
  it("Schedule C line numbers only for a sole proprietor", () => {
    expect(tax).toMatch(/const scheduleC = !legalForm \|\| legalForm === "sole_prop";/);
    expect(tax).toMatch(/\{scheduleC && <span[^>]*> · line \{d\.line\}<\/span>\}/);
  });
  it("a C corporation sees no personal-return items; an S corporation is told retirement follows salary", () => {
    expect(tax).toMatch(/deductions\.filter\(d => d\.ask && legalForm !== "c_corp"\)/);
    expect(tax).toMatch(/based on the salary the company pays you, not its profit/);
  });
  it("the preparer's file never lists equipment whose purchase was undone", () => {
    expect(tax).toMatch(/\.filter\(a => a && !a\.deleted_at && sourcePurchaseLive\(invoices, a\.source_journal_entry_id\)\)/);
  });
  it("a year before the books start is said to be empty", () => {
    const r = taxPacketRows({ year: 2025, cutoffDate: "2026-01-01" }).find((x) => x[1] === "Books start");
    expect(r[3]).toMatch(/after 2025, so this year isn't in the books/);
    expect(taxPacketRows({ year: 2026, cutoffDate: "2026-01-01" }).find((x) => x[1] === "Books start")).toBeUndefined();
  });
});
