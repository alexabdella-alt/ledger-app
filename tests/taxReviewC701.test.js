// C701 — fixes from the review of C697 / C699 / C700.
import { describe, it, expect } from "vitest";
import { taxPacketRows } from "../src/lib/taxPacket.js";
import { readFileSync } from "node:fs";

describe("C701 — the summary says what it covers", () => {
  const find = (rows, item) => rows.find((r) => r[1] === item);
  it("books that start partway through the year", () => {
    expect(find(taxPacketRows({ year: 2025, cutoffDate: "2025-03-01" }), "Books start")[3]).toMatch(/^2025-03-01 — anything earlier/);
    expect(find(taxPacketRows({ year: 2025, cutoffDate: "2025-01-01" }), "Books start")).toBeUndefined();
    expect(find(taxPacketRows({ year: 2025, cutoffDate: "2024-07-01" }), "Books start")).toBeUndefined();
  });
  it("the year so far, and carried answers", () => {
    expect(find(taxPacketRows({ year: 2026, yearSoFar: true }), "Covers")[3]).toMatch(/not a full year/);
    expect(find(taxPacketRows({ year: 2026, profile: { carried: true } }), "Answers")[3]).toMatch(/carried over/);
  });
  it("a negative total is explained", () => {
    expect(find(taxPacketRows({ year: 2026, est: { total: -2200, federal: -2200, seTax: 0 } }), "Total federal (estimate)")[3]).toMatch(/what the business's loss saves/);
  });
});

describe("C701 — the screens", () => {
  const tax = readFileSync("src/components/views/TaxView.jsx", "utf8");
  it("last year's summary uses last year's answers only; a failed read stops it", () => {
    expect(tax).toMatch(/const p = packetYear === year \? taxProfileFrom\(rowFiled, filedDeadlinesPrev \|\| \{\}\) : taxProfileFrom\(rowFiled, \{\}\);/);
    expect(tax).toMatch(/We couldn't load your \$\{packetYear\} tax answers, so the summary wasn't made/);
  });
  it("Home and the bell subtract this year's estimated payments; the Taxes screen pushes them", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/\.select\("filed_deadlines, estimated_payments_made"\)\.eq\("company_id", cid\)\.eq\("tax_year", new Date\(\)\.getFullYear\(\)\)/);
    expect(app).toMatch(/estimateFor: \(y\) => taxEstimate\(invoicesRef\.current, y, paidForYear\(y, \{ thisYear: estPaidRef\.current, lastYear: estPaidPrevRef\.current \}\),/);   // C704
    expect(tax).toMatch(/setEstPaidThisYear && setEstPaidThisYear\(Number\(next\.estPaid\) \|\| 0\);/);
  });
  it("an S corporation owner is told where their health insurance goes", () => {
    expect(tax).toMatch(/As an S corporation owner, health insurance the company pays and adds to your W-2/);
  });
});
