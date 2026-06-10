import { describe, it, expect } from "vitest";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType, calcASC842 } from "../src/lib/gl.js";

// ── Item 2: GL classification ──────────────────────────────────────────────
describe("GL classification", () => {
  it("classifies revenue (4xxx)", () => {
    expect(glIsRevenue("4000")).toBe(true);
    expect(glIsRevenue("4100")).toBe(true);
    expect(glIsRevenue("6000")).toBe(false);
    expect(glIsRevenue("1000")).toBe(false);
  });

  it("classifies expenses (5xxx–8xxx)", () => {
    for (const c of ["5000", "6100", "6400", "7100", "8000"]) expect(glIsExpense(c)).toBe(true);
    expect(glIsExpense("4000")).toBe(false); // revenue
    expect(glIsExpense("1000")).toBe(false); // asset
  });

  it("classifies balance-sheet accounts (1xxx–3xxx)", () => {
    expect(glIsBalSheet("1000")).toBe(true);  // asset
    expect(glIsBalSheet("2000")).toBe(true);  // liability
    expect(glIsBalSheet("3100")).toBe(true);  // equity
    expect(glIsBalSheet("4000")).toBe(false); // revenue
    expect(glIsBalSheet("6000")).toBe(false); // expense
  });

  it("glPLType returns revenue | expense | null", () => {
    expect(glPLType("4000")).toBe("revenue");
    expect(glPLType("6100")).toBe("expense");
    expect(glPLType("1000")).toBe(null); // balance sheet → not a P&L line
  });

  it("rejects non-string / empty codes safely", () => {
    expect(glIsRevenue(null)).toBe(false);
    expect(glIsExpense(undefined)).toBe(false);
    expect(glIsBalSheet(4000)).toBe(false); // number, not string
  });
});

// ── Item 1: ASC 842 lease calculations ─────────────────────────────────────
describe("calcASC842", () => {
  // $1,000/mo, 36 months, 6% annual IBR (0.5%/mo).
  const r = calcASC842(1000, 36, 0.06);

  it("computes lease liability as the PV of an ordinary annuity", () => {
    // PV = P * (1 - (1+i)^-n) / i, i = 0.005, n = 36
    const i = 0.06 / 12;
    const expected = 1000 * (1 - Math.pow(1 + i, -36)) / i;
    expect(r.leaseLiability).toBeCloseTo(Math.round(expected * 100) / 100, 2);
    // sanity: PV is less than total undiscounted payments (36 * 1000 = 36,000)
    expect(r.leaseLiability).toBeLessThan(36000);
    expect(r.leaseLiability).toBeGreaterThan(32000);
  });

  it("sets ROU asset equal to the lease liability at commencement (entry balances)", () => {
    expect(r.rouAsset).toBe(r.leaseLiability);
  });

  it("splits current + non-current to equal the total liability", () => {
    expect(r.currentPortion + r.nonCurrentPortion).toBeCloseTo(r.leaseLiability, 2);
    expect(r.currentPortion).toBeGreaterThan(0);
    expect(r.nonCurrentPortion).toBeGreaterThan(0);
  });

  it("builds a full amortization schedule that pays the balance to ~0", () => {
    expect(r.schedule).toHaveLength(36);
    expect(r.schedule[35].balance).toBeCloseTo(0, 2);
    // every month: interest + principal === payment
    for (const row of r.schedule) {
      expect(row.interest + row.principal).toBeCloseTo(1000, 6);
    }
  });

  it("handles a 0% IBR (liability = sum of payments)", () => {
    const z = calcASC842(500, 12, 0);
    expect(z.leaseLiability).toBe(6000);
    expect(z.rouAsset).toBe(6000);
  });
});
