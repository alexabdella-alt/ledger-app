// C720 — contract schedules: the payment's frequency, the whole term, month-end dates, the lease's
// current / long-term split, and the cents.
import { describe, it, expect } from "vitest";
import { planContractEntries, monthlyFactor, termMonths } from "../src/lib/contractEntries";

const ROLES = {
  rou_asset:"1600", lease_liability_current:"2400", lease_liability_noncurrent:"2500",
  operating_lease_expense:"6110", cash:"1000", interest_expense:"8000",
  rou_amortization:"6910", accumulated_amortization_rou:"1610",
  technology_software:"6500", prepaid_expenses:"1400", deferred_revenue:"2300", service_revenue:"4100",
};
const plan = (contract) => planContractEntries({ contract, rc: (x) => ROLES[x], rn: (x) => x, today: "2026-08-30", defaultIbr: 0.06 });
const r2 = (n) => Math.round(n * 100) / 100;
// running balance of an account over the Day-1 entry + every monthly entry (debit-positive)
const balances = (r, code) => {
  const all = [...(r.contract.journal_entries || []).slice(0, 1), ...r.monthlyEntries];
  let b = 0; const out = [];
  for (const e of all) { for (const l of e.lines) if (l.account_code === code) b = r2(b + (Number(l.debit) || 0) - (Number(l.credit) || 0)); out.push(b); }
  return out;
};
const total = (r, code, side) => r2(r.monthlyEntries.flatMap((e) => e.lines).filter((l) => l.account_code === code).reduce((s, l) => s + (Number(l[side]) || 0), 0));

describe("★ how often the payment is made", () => {
  it("the factors", () => {
    expect([monthlyFactor("monthly"), monthlyFactor("Quarterly"), monthlyFactor("annual"), monthlyFactor("semi-annual"), monthlyFactor("one-time"), monthlyFactor("???")])
      .toEqual([1, 1 / 3, 1 / 12, 1 / 6, null, 1]);
  });
  it("a $12,000/year subscription is $12,000 of expense, $1,000 a month — was $144,000", () => {
    const r = plan({ contract_type: "subscription_paid", payment_amount: 12000, payment_frequency: "annual", start_date: "2026-01-01", end_date: "2026-12-31" });
    expect(r.monthlyEntries).toHaveLength(12);
    expect(total(r, "6500", "debit")).toBe(12000);
    expect(r.monthlyEntries[0].lines[0].debit).toBe(1000);
  });
  it("one payment for the whole term is spread over it", () => {
    const r = plan({ contract_type: "subscription_paid", payment_amount: 1000, payment_frequency: "one-time", start_date: "2026-01-01", end_date: "2026-03-31" });
    expect(r.monthlyEntries.map((e) => e.lines[0].debit)).toEqual([333.33, 333.33, 333.34]);   // the last takes the cents
  });
  it("a $6,000/quarter lease pays $72,000 over three years — was $216,000", () => {
    const r = plan({ contract_type: "lease", lease_type: "operating", payment_amount: 6000, payment_frequency: "quarterly", start_date: "2026-01-01", end_date: "2028-12-31", discount_rate_used: 0.06 });
    expect(r.leaseTermMonths).toBe(36);
    expect(total(r, "1000", "credit")).toBe(72000);
  });
});

describe("★ the whole term, dated in the month it covers", () => {
  it("Jan–Dec is recognized Jan 31 … Dec 31, all in the year", () => {
    const r = plan({ contract_type: "revenue_contract", payment_amount: 1000, start_date: "2026-01-01", end_date: "2026-12-31" });
    expect(r.monthlyEntries[0].date).toBe("2026-01-31");
    expect(r.monthlyEntries[11].date).toBe("2026-12-31");
    expect(r.monthlyEntries.every((e) => e.date.startsWith("2026"))).toBe(true);
  });
  it("a 7-year revenue contract recognizes all 84 months — was cut at 60", () => {
    const r = plan({ contract_type: "revenue_contract", payment_amount: 1000, start_date: "2026-01-01", end_date: "2032-12-31" });
    expect(total(r, "4100", "credit")).toBe(84000);
  });
  it("term counting", () => {
    expect(termMonths("2026-01-01", "2026-12-31")).toBe(12);
    expect(termMonths("2026-01-15", "2027-01-14")).toBe(12);
    expect(termMonths("2026-03-01", "2027-02-28")).toBe(12);
    expect(termMonths("x", "2026-01-01")).toBe(0);
    expect(termMonths("2026-01-01", "2026-06-20")).toBe(6);   // a part month past the 15th counts
  });
});

describe("★ a lease's liability: current never negative, long-term moves in, both end at zero", () => {
  for (const [lease_type, pay, n, rate] of [["operating", 2500, 36, 0.06], ["finance", 2500, 36, 0.06], ["operating", 1500, 24, 0.05], ["finance", 1000, 7, 0.05], ["operating", 4321.17, 61, 0.071]]) {
    it(`${lease_type} $${pay} × ${n} @ ${rate}`, () => {
      const start = "2026-01-01", end = (() => { const d = new Date(2026, n, 0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
      const r = plan({ contract_type: "lease", lease_type, payment_amount: pay, start_date: start, end_date: end, discount_rate_used: rate });
      expect(r.leaseTermMonths).toBe(n);
      const cur = balances(r, "2400"), lt = balances(r, "2500"), rou = balances(r, "1600"), acc = balances(r, "1610");
      expect(Math.max(...cur)).toBeLessThanOrEqual(0.001);                      // a liability (credit) — never a debit balance
      expect(Math.max(...lt)).toBeLessThanOrEqual(0.001);
      expect(cur[cur.length - 1]).toBe(0);
      expect(lt[lt.length - 1]).toBe(0);
      if (lease_type === "operating") expect(rou[rou.length - 1]).toBe(0);
      else expect(r2(rou[rou.length - 1] + acc[acc.length - 1])).toBe(0);          // net book value nets to zero
      expect(total(r, "1000", "credit")).toBe(r2(pay * n));                        // the cash is the payments
      for (const e of [...r.contract.journal_entries.slice(0, 1), ...r.monthlyEntries]) {
        const d = e.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0), c = e.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
        expect(Math.abs(d - c)).toBeLessThan(0.005);
      }
      // from month 13 on, "current" holds the next twelve months' principal
      if (n > 13) expect(-cur[1]).toBeGreaterThan(0);
    });
  }
});

import { depreciationAmounts, buildDepreciationSchedule } from "../src/lib/depreciation.js";
import { buildPrepaidSchedule } from "../src/lib/prepaid.js";
describe("★ a schedule never takes more than is left", () => {
  const sum = (a) => Math.round(a.reduce((s, x) => s + x, 0) * 100) / 100;
  it("straight line: $3.00 over 468 months is $3.00, no month negative", () => {
    const a = depreciationAmounts({ base: 3, periods: 468 });
    expect(sum(a)).toBe(3);
    expect(Math.min(...a)).toBeGreaterThanOrEqual(0);
    const s = buildDepreciationSchedule({ cost: 5000, salvage: 4997, lifeMonths: 468, inServiceDate: "2026-01-01", depExpCode: "6900", accumDepCode: "1510" });
    const posted = Math.round(s.entries.reduce((t, e) => t + e.lines.reduce((u, l) => u + (Number(l.debit) || 0), 0), 0) * 100) / 100;
    expect(posted).toBe(3);
    expect(s.total).toBe(3);
  });
  it("declining balance with a rate above the periods stops at the base", () => {
    const a = depreciationAmounts({ method: "declining_balance", base: 1000, periods: 2, rate: 3 });
    expect(a).toEqual([1000, 0]);
  });
  it("a prepaid schedule has no empty rows and adds to the total", () => {
    const s = buildPrepaidSchedule({ total: 0.05, months: 12, startDate: "2026-01-01", expenseCode: "6100", prepaidCode: "1400" });
    expect(s.entries.every(Boolean)).toBe(true);
    expect(s.total).toBe(0.05);
  });
});
