// C700 — the self-employed health insurance deduction (§162(l)) in the estimate.
import { describe, it, expect } from "vitest";
import { federalEstimate } from "../src/lib/taxGuidance.js";
import { taxEstimate, taxProfileFrom } from "../src/lib/tax.js";
import { taxPacketRows } from "../src/lib/taxPacket.js";
import { readFileSync } from "node:fs";

const r2 = (n) => Math.round(n * 100) / 100;

describe("C700 — lowers income tax, not SE tax, up to the profit", () => {
  it("premiums reduce taxable income and the 20% deduction's base", () => {
    const a = federalEstimate({ revenue: 80000, year: 2026, otherIncome: 200000 });
    const b = federalEstimate({ revenue: 80000, year: 2026, otherIncome: 200000, healthPremiums: 9000 });
    expect(b.seTax).toBe(a.seTax);
    expect(b.healthDeduction).toBe(9000);
    expect(b.qbi).toBe(r2((80000 - b.halfSe - 9000) * 0.2));
    expect(b.federal).toBeLessThan(a.federal);
  });
  it("capped at profit less half the SE tax and the retirement contribution", () => {
    const f = federalEstimate({ revenue: 10000, year: 2026, healthPremiums: 50000, retirement: 2000 });
    expect(f.healthDeduction).toBe(r2(10000 - f.halfSe - 2000));
    expect(federalEstimate({ revenue: -5000, year: 2026, otherIncome: 60000, healthPremiums: 9000 }).healthDeduction).toBe(0);
  });
  it("not for an S corporation here (its premiums go through payroll)", () => {
    expect(federalEstimate({ revenue: 80000, year: 2026, legalForm: "s_corp", healthPremiums: 9000 }).healthDeduction).toBe(0);
  });
});

describe("C700 — asked once, carried forward, used everywhere", () => {
  it("saved as health_premiums; carried to next year until changed", () => {
    expect(taxProfileFrom({ health_premiums: "7200" }).healthPremiums).toBe(7200);
    expect(taxProfileFrom({}, { health_premiums: 7200 })).toMatchObject({ healthPremiums: 7200, carried: true });
  });
  it("the estimate, the screen, the summary and the assistant", () => {
    const led = [{ gl_code: "4000", amount: 80000, debit_credit: "credit", date: "2026-03-01", status: "posted" }];
    expect(taxEstimate(led, 2026, 0, { healthPremiums: 6000 }).healthDeduction).toBe(6000);
    const rows = taxPacketRows({ year: 2026, legalForm: "sole_prop", profile: { healthPremiums: 6000 }, est: { healthDeduction: 6000 } });
    expect(rows.find((r) => r[1] === "Health insurance you paid for yourself")[2]).toBe(6000);
    expect(readFileSync("src/components/views/TaxView.jsx", "utf8")).toMatch(/health_premiums: v/);
    expect(readFileSync("src/components/views/TaxView.jsx", "utf8")).toMatch(/could have joined a plan through a job — yours or a spouse's/);
    expect(readFileSync("src/lib/aiTools.js", "utf8")).toMatch(/health_insurance_deduction: est\.healthDeduction/);
  });
});
