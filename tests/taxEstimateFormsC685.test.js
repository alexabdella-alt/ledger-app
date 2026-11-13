// C685 — the federal estimate by legal form and the small SE-tax rules (review of C678).
import { describe, it, expect } from "vitest";
import { federalEstimate, SE_MINIMUM, ADDL_MEDICARE_THRESHOLD } from "../src/lib/taxGuidance.js";
import { readFileSync } from "node:fs";

const r2 = (n) => Math.round(n * 100) / 100;

describe("C685 — an S corporation's profit is not self-employment income", () => {
  it("an S corp pays no self-employment tax but keeps the QBI deduction", () => {
    const f = federalEstimate({ revenue: 100000, year: 2026, legalForm: "s_corp", flatRate: 0.25 });
    expect(f.seTax).toBe(0);
    expect(f.addlMedicare).toBe(0);
    expect(f.qbi).toBe(20000);
    expect(f.federal).toBe(20000);
    expect(f.total).toBe(20000);
  });
  it("a sole proprietor and a partnership still pay it", () => {
    for (const legalForm of ["", "sole_prop", "partnership"]) {
      expect(federalEstimate({ revenue: 100000, year: 2026, legalForm }).seTax).toBe(r2(92350 * 0.153));
    }
  });
  it("a C corporation is a flat 21%", () => {
    const f = federalEstimate({ revenue: 100000, year: 2026, legalForm: "c_corp" });
    expect(f).toMatchObject({ seTax: 0, total: 21000 });
  });
});

describe("C685 — the $400 floor and the 0.9% Additional Medicare tax", () => {
  it("no self-employment tax under $400 of net earnings", () => {
    expect(SE_MINIMUM).toBe(400);
    expect(federalEstimate({ revenue: 430, year: 2026 }).seTax).toBe(0);           // 430 × 92.35% = 397.11
    expect(federalEstimate({ revenue: 434, year: 2026 }).seTax).toBe(r2(434 * 0.9235 * 0.153));   // 400.80
  });
  it("0.9% on earnings over $200,000, not halved", () => {
    expect(ADDL_MEDICARE_THRESHOLD).toBe(200000);
    const f = federalEstimate({ revenue: 400000, year: 2026 });
    expect(f.addlMedicare).toBe(r2((400000 * 0.9235 - 200000) * 0.009));
    expect(f.halfSe).toBe(r2(f.seTax / 2));
    expect(f.total).toBe(r2(f.federal + f.seTax + f.addlMedicare));
    expect(federalEstimate({ revenue: 200000, year: 2026 }).addlMedicare).toBe(0);  // 184,700 earnings
  });
});

describe("C685 — the Taxes screen names the tax a corporation actually pays", () => {
  const src = readFileSync(new URL("../src/components/views/TaxView.jsx", import.meta.url), "utf8");
  it("labels both lines by legal form", () => {
    expect(src).toMatch(/legalForm === "c_corp" \? "Corporate income tax \(21%\)"/);
    expect(src).toMatch(/legalForm === "s_corp" \|\| legalForm === "c_corp" \? "Self-employment tax \(none/);
  });
});
