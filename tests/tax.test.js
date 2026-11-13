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

  // ★ C678 — current rules (lib/taxGuidance.js), not a flat 25% + 15.3% on book profit.
  it("estimates federal + self-employment tax by current rules", () => {
    const invoices = [
      { gl_code: "4000", amount: 10000, date: `2026-02-01`, status: "posted" }, // revenue
      { gl_code: "6100", gl_name: "Rent & Occupancy", amount: 4000, date: `2026-03-01`, status: "posted" },  // rent — fully deductible
    ];
    const est = taxEstimate(invoices, 2026, 500);
    expect(est.net).toBe(6000);
    expect(est.seTax).toBe(847.77);    // 6000 × 92.35% × 15.3%
    expect(est.qbi).toBe(1115.22);     // 20% of (6000 − half the SE tax)
    expect(est.federal).toBe(1115.22); // 25% planning rate on what's left
    expect(est.total).toBe(1962.99);
    expect(est.owed).toBeCloseTo(1462.99, 2);    // total − estPaid(500)
    expect(est.quarterly).toBeCloseTo(1962.99 / 4, 2);
  });
  it("a C corporation pays a flat 21% and no self-employment tax", () => {
    const est = taxEstimate([{ gl_code: "4000", amount: 6000, date: "2026-02-01", status: "posted" }], 2026, 0, { legalForm: "c_corp" });
    expect([est.seTax, est.federal, est.total]).toEqual([0, 1260, 1260]);
  });
  it("half of a business meal stays taxable — profit is income less the DEDUCTIBLE share", () => {
    const est = taxEstimate([{ gl_code: "4000", amount: 6000, date: "2026-02-01", status: "posted" },
      { gl_code: "6400", gl_name: "Travel & Entertainment", vendor: "Corner Bistro", amount: 200, date: "2026-02-03", status: "posted" }], 2026, 0,
      { chart: [{ code: "6400", name: "Travel & Entertainment", system_role: "travel_entertainment" }] });
    expect(est.taxableNet).toBe(5900);   // 6000 − 100 (half the meal)
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

  // C678 — keyed by the Schedule C line each account goes on.
  it("resolves accounts by system_role to their Schedule C line — the hint is the account's NAME, never its code (C386)", () => {
    expect(byKey["27a"].hint).toBe(getAccountByRole("technology_software").name);   // software → Other expenses
    expect(byKey["20b"].hint).toBe(getAccountByRole("rent_occupancy").name);        // rent → line 20b
    expect(byKey["20b"].hint).not.toMatch(/\d{4}/);
  });

  it("sums each line for the current year, excluding voided/prior-year", () => {
    expect(byKey["27a"].amount).toBe(1000);
    expect(byKey["20b"].amount).toBe(2000);
  });

  it("a Travel & Entertainment charge that isn't travel counts as a business meal: 50%", () => {
    expect(byKey["24b"].raw).toBe(1000);
    expect(byKey["24b"].amount).toBe(500);
  });

  it("total deductible = sum of categories with T&E halved", () => {
    const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
    expect(total).toBe(3500); // 1000 + 2000 + 500
  });
});
