// C726 — Home's "this year" is the fiscal year; a quarterly or yearly lease pays on its own dates.
import { describe, it, expect } from "vitest";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { businessHealth } from "../src/lib/reports.js";
import { planContractEntries } from "../src/lib/contractEntries.js";

const je = (id, date, lines) => ({ id, entry_date: date, description: `x – ${id}`, status: "posted", deleted_at: null, source: "manual",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: { code: l.code, name: l.code } })) });

describe("★ Home's profit this year follows the fiscal year", () => {
  const rows = flattenJournalEntries([
    je("a", "2026-03-01", [{ code: "1000", debit: 5000 }, { code: "4000", credit: 5000 }]),   // last fiscal year for a July–June company
    je("b", "2026-08-01", [{ code: "1000", debit: 2000 }, { code: "4000", credit: 2000 }]),
  ]);
  const NOW = new Date(2026, 10, 13);
  it("July–June: only August counts", () => {
    const h = businessHealth(rows, { cash: 7000, now: NOW, fiscalYearEnd: "06-30" });
    expect(h.ownerFacts.find((f) => f.key === "profit").value).toBe("$2,000.00");
    expect(h.facts.find((f) => f.key === "profit").label).toBe("Net income · this fiscal year");
  });
  it("a calendar year is unchanged", () => {
    expect(businessHealth(rows, { cash: 7000, now: NOW }).ownerFacts.find((f) => f.key === "profit").value).toBe("$7,000.00");
  });
  it("the books' start date floors it", () => {
    expect(businessHealth(rows, { cash: 7000, now: NOW, cutoffDate: "2026-06-01" }).ownerFacts.find((f) => f.key === "profit").value).toBe("$2,000.00");
  });
});

describe("★ a quarterly lease pays every three months", () => {
  const ROLES = { rou_asset: "1600", lease_liability_current: "2400", lease_liability_noncurrent: "2500", operating_lease_expense: "6110", cash: "1000",
    interest_expense: "8000", rou_amortization: "6910", accumulated_amortization_rou: "1610" };
  const plan = (c) => planContractEntries({ contract: c, rc: (x) => ROLES[x], rn: (x) => x, today: "2026-08-30" });
  const cashOut = (r) => r.monthlyEntries.flatMap((e) => e.lines.filter((l) => l.account_code === "1000" && l.credit > 0).map(() => [e.date, e.lines.find((l) => l.account_code === "1000").credit]));
  for (const lease_type of ["operating", "finance"]) {
    it(`${lease_type}: cash leaves on months 3, 6, 9 … and totals the payments; the liability never turns`, () => {
      const r = plan({ contract_type: "lease", lease_type, payment_amount: 6000, payment_frequency: "quarterly", start_date: "2026-01-01", end_date: "2026-12-31", discount_rate_used: 0.06 });
      expect(cashOut(r)).toEqual([["2026-03-31", 6000], ["2026-06-30", 6000], ["2026-09-30", 6000], ["2026-12-31", 6000]]);
      let cur = 0;
      for (const e of [r.contract.journal_entries[0], ...r.monthlyEntries]) for (const l of e.lines) if (l.account_code === "2400") cur = Math.round((cur + l.debit - l.credit) * 100) / 100;
      expect(cur).toBe(0);
      expect(r.monthlyEntries.filter((e) => /lease payment — Month|Finance lease payment/i.test(e.description) && e.lines.some((l) => l.account_code === "6110" || l.account_code === "8000")).length).toBe(12);   // the cost, every month
    });
  }
  it("a part period at the end is paid in the last month", () => {
    const r = plan({ contract_type: "lease", lease_type: "operating", payment_amount: 3000, payment_frequency: "quarterly", start_date: "2026-01-01", end_date: "2026-07-31", discount_rate_used: 0.06 });
    expect(cashOut(r).map(([d, a]) => [d, a])).toEqual([["2026-03-31", 3000], ["2026-06-30", 3000], ["2026-07-31", 1000]]);
  });
  it("a monthly lease is unchanged: cash each month", () => {
    const r = plan({ contract_type: "lease", lease_type: "operating", payment_amount: 1000, start_date: "2026-01-01", end_date: "2026-06-30", discount_rate_used: 0.06 });
    expect(cashOut(r)).toHaveLength(6);
  });
});
