import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { planContractEntries } from "../src/lib/contractEntries";

const ROLES = {
  rou_asset:"1600", lease_liability_current:"2400", lease_liability_noncurrent:"2500",
  operating_lease_expense:"6110", cash:"1000", interest_expense:"8000",
  rou_amortization:"6910", accumulated_amortization_rou:"1610",
  technology_software:"6500", prepaid_expenses:"1400", deferred_revenue:"2300", service_revenue:"4100",
};
const rc = (x) => ROLES[x];
const rn = (x) => x;
const plan = (contract) => planContractEntries({ contract, rc, rn, today: "2026-08-30", defaultIbr: 0.06 });
const lease = (o = {}) => ({ contract_type:"lease", lease_type:"operating", payment_amount:4200, start_date:"2026-01-01", end_date:"2026-12-31", discount_rate_used:0.06, ...o });

const sums = (e) => e.lines.reduce((a, l) => ({ d: a.d + (Number(l.debit)||0), c: a.c + (Number(l.credit)||0) }), { d:0, c:0 });

describe("a contract becomes a schedule of entries", () => {
  it("a 12-month operating lease produces a Day 1 entry and monthly entries", () => {
    const r = plan(lease());
    expect(r.leaseTermMonths).toBe(12);
    expect(r.contract.journal_entries[0].lines.length).toBe(3);
    expect(r.monthlyEntries.length).toBeGreaterThanOrEqual(12);
  });

  it("★ the Day 1 entry balances: ROU asset against current + non-current liability", () => {
    const { contract } = plan(lease());
    const { d, c } = sums(contract.journal_entries[0]);
    expect(Math.abs(d - c)).toBeLessThan(0.005);
    expect(contract.rou_asset_value).toBeGreaterThan(0);
    expect(contract.lease_liability_current + contract.lease_liability_noncurrent).toBeCloseTo(contract.rou_asset_value, 2);
  });

  it("★ the model's own arithmetic is overwritten, never trusted", () => {
    const { contract } = plan(lease({ rou_asset_value: 999999, lease_liability_current: 111 }));
    expect(contract.rou_asset_value).not.toBe(999999);
    expect(contract.lease_liability_current).not.toBe(111);
  });

  it("a finance lease books interest, principal and ROU amortisation", () => {
    const r = plan(lease({ lease_type: "finance" }));
    const kinds = r.monthlyEntries.map((e) => e.description);
    expect(kinds.some((k) => /Finance lease payment/.test(k))).toBe(true);
    expect(kinds.some((k) => /ROU asset amortization/.test(k))).toBe(true);
  });
});

describe("★★★ every generated entry balances — swept, because it was true only by coincidence", () => {
  // A finance-lease month debits interest AND principal against one payment credit, each
  // rounded INDEPENDENTLY. It works because calcASC842 computes principal = payment − interest
  // exactly, so the two rounding errors mirror — except at an exact half-cent tie, where
  // Math.round sends both the same way and the entry breaks by a cent. buildJournalEntry
  // REFUSES an unbalanced entry, so the failure mode is a lease month that silently does not
  // post. This sweep is what keeps a "simplification" of the rounding from reintroducing it.
  it.each([["operating"], ["finance"]])("%s leases, across 180 payment/term/rate combinations", (leaseType) => {
    let checked = 0;
    for (const payment_amount of [1500, 4200, 2733.33, 987.65, 12500, 333.33]) {
      for (const months of [12, 24, 36, 60, 13, 47]) {
        for (const discount_rate_used of [0.05, 0.065, 0.0725, 0.09, 0.1234]) {
          const r = plan(lease({ lease_type: leaseType, payment_amount, discount_rate_used, lease_term_months: months }));
          for (const e of [...r.contract.journal_entries, ...r.monthlyEntries]) {
            const { d, c } = sums(e);
            checked++;
            if (Math.abs(d - c) >= 0.005) throw new Error(`unbalanced ${leaseType} entry: ${e.description} — Dr ${d} Cr ${c} (payment ${payment_amount}, ${months}m @ ${discount_rate_used})`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(2000);   // the sweep is real, not an empty loop
  });
});

describe("non-lease contracts", () => {
  it("a paid subscription amortises prepaid into software expense", () => {
    const r = plan({ contract_type:"subscription_paid", payment_amount:99, start_date:"2026-01-01", end_date:"2026-12-31" });
    expect(r.monthlyEntries.length).toBeGreaterThan(0);
    expect(r.monthlyEntries[0].lines[0].account_code).toBe("6500");
    expect(r.monthlyEntries[0].lines[1].account_code).toBe("1400");
    expect(sums(r.monthlyEntries[0]).d).toBeCloseTo(sums(r.monthlyEntries[0]).c, 2);
  });

  it("a revenue contract recognises deferred revenue (ASC 606)", () => {
    const r = plan({ contract_type:"revenue_contract", payment_amount:2500, start_date:"2026-01-01", end_date:"2026-06-30" });
    expect(r.monthlyEntries[0].lines[0].account_code).toBe("2300");
    expect(r.monthlyEntries[0].lines[1].account_code).toBe("4100");
  });

  it("★ a contract with no dates or no payment produces no entries rather than guessing", () => {
    expect(plan({ contract_type:"subscription_paid", payment_amount:99 }).monthlyEntries).toEqual([]);
    expect(plan({ contract_type:"lease", payment_amount:0, start_date:"2026-01-01", end_date:"2026-12-31" }).monthlyEntries).toEqual([]);
  });

  it("★ a long contract is capped at 60 months rather than generating thousands of rows", () => {
    const r = plan({ contract_type:"subscription_paid", payment_amount:99, start_date:"2026-01-01", end_date:"2046-01-01" });
    expect(r.monthlyEntries.length).toBe(60);
  });
});

describe("it computes and does nothing else", () => {
  it("★★ no clock, no client, no writes", () => {
    const src = readFileSync("src/lib/contractEntries.js", "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    for (const f of ["supabase", "Date.now", "Math.random", "persistJournalEntry", "post_journal_entry", "bookToDb"]) {
      expect(src).not.toContain(f);
    }
  });

  it("★ pure — same contract, same schedule", () => {
    expect(JSON.stringify(plan(lease()))).toBe(JSON.stringify(plan(lease())));
  });
});
