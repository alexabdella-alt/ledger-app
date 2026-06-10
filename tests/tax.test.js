import { describe, it, expect } from "vitest";
import { ytdNetIncome, taxEstimate, deductionBreakdown, FED_RATE, SE_RATE } from "../src/lib/tax.js";
import { FED_TAX_RATE, SE_TAX_RATE, DEFAULT_CHART_OF_ACCOUNTS } from "../src/lib/constants.js";

const YEAR = 2026;

// Mirror useAccounts: resolve a system_role to its account (Item 6).
const byRole = Object.fromEntries(DEFAULT_CHART_OF_ACCOUNTS.map(a => [a.system_role, a]));
const getAccountByRole = (role) => byRole[role] || null;

// ── Item 3: tax rate constants + estimate ──────────────────────────────────
describe("tax calculations", () => {
  it("exposes the simplified planning rates", () => {
    expect(FED_RATE).toBe(0.25);
    expect(SE_RATE).toBe(0.153);
    expect(FED_RATE).toBe(FED_TAX_RATE);
    expect(SE_RATE).toBe(SE_TAX_RATE);
  });

  it("estimates federal + SE tax from net income", () => {
    const invoices = [
      { gl_code: "4000", amount: 10000, date: `${YEAR}-02-01`, status: "posted" }, // revenue
      { gl_code: "6100", amount: 4000, date: `${YEAR}-03-01`, status: "posted" },  // expense
    ];
    const est = taxEstimate(invoices, YEAR, 500);
    expect(est.net).toBe(6000);
    expect(est.federal).toBeCloseTo(1500, 2); // 6000 * 0.25
    expect(est.seTax).toBeCloseTo(918, 2);    // 6000 * 0.153
    expect(est.total).toBeCloseTo(2418, 2);
    expect(est.owed).toBeCloseTo(1918, 2);    // total - estPaid(500)
    expect(est.quarterly).toBeCloseTo(2418 / 4, 2);
  });

  it("never produces negative tax when the business is unprofitable", () => {
    const invoices = [{ gl_code: "6100", amount: 8000, date: `${YEAR}-01-01`, status: "posted" }];
    const est = taxEstimate(invoices, YEAR);
    expect(est.net).toBe(-8000);
    expect(est.taxableNet).toBe(0);
    expect(est.total).toBe(0);
    expect(est.owed).toBe(0);
  });
});

// ── Item 5: soft-delete / voided filtering ─────────────────────────────────
describe("soft-delete filtering", () => {
  const invoices = [
    { gl_code: "4000", amount: 10000, date: `${YEAR}-02-01`, status: "posted" },
    { gl_code: "6100", amount: 3000, date: `${YEAR}-02-01`, status: "voided" },        // excluded
    { gl_code: "6100", amount: 2000, date: `${YEAR}-02-01`, status: "deleted" },       // excluded
    { gl_code: "6100", amount: 1000, date: `${YEAR}-02-01`, deleted_at: `${YEAR}-03-01` }, // excluded
    { gl_code: "6100", amount: 500, date: `${YEAR}-02-01`, status: "posted" },         // counted
  ];
  it("ytdNetIncome excludes voided and soft-deleted entries", () => {
    const { revenue, expenses, net } = ytdNetIncome(invoices, YEAR);
    expect(revenue).toBe(10000);
    expect(expenses).toBe(500);   // only the live expense
    expect(net).toBe(9500);
  });

  it("excludes entries from other calendar years", () => {
    const mixed = [
      { gl_code: "4000", amount: 5000, date: `${YEAR}-01-01`, status: "posted" },
      { gl_code: "4000", amount: 9999, date: `${YEAR - 1}-12-31`, status: "posted" }, // prior year
    ];
    expect(ytdNetIncome(mixed, YEAR).revenue).toBe(5000);
  });
});

// ── Items 6 & 8: deduction breakdown via roles, T&E at 50% ──────────────────
describe("deductionBreakdown", () => {
  const invoices = [
    { gl_code: "6500", amount: 1000, date: `${YEAR}-04-01`, status: "posted" }, // tech
    { gl_code: "6100", amount: 2000, date: `${YEAR}-04-01`, status: "posted" }, // rent
    { gl_code: "6400", amount: 1000, date: `${YEAR}-04-01`, status: "posted" }, // T&E → counts 50%
    { gl_code: "6500", amount: 5000, date: `${YEAR}-04-01`, status: "voided" }, // excluded
    { gl_code: "6500", amount: 9999, date: `${YEAR - 1}-04-01`, status: "posted" }, // prior year, excluded
  ];
  const rows = deductionBreakdown(invoices, YEAR, getAccountByRole);
  const byKey = Object.fromEntries(rows.map(r => [r.key, r]));

  it("resolves category accounts by system_role", () => {
    expect(byKey.software.hint).toContain("6500");
    expect(byKey.rent.hint).toContain("6100");
  });

  it("sums each category for the current year, excluding voided/prior-year", () => {
    expect(byKey.software.amount).toBe(1000);
    expect(byKey.rent.amount).toBe(2000);
  });

  it("counts Travel & Entertainment at 50%", () => {
    expect(byKey.travel.raw).toBe(1000);
    expect(byKey.travel.amount).toBe(500);
  });

  it("total deductible = sum of categories with T&E halved", () => {
    const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
    expect(total).toBe(3500); // 1000 + 2000 + 500
  });
});
