// C697 — Home says what to keep back for taxes, from the Taxes screen's estimate.
import { describe, it, expect } from "vitest";
import { setAsideLine } from "../src/lib/taxSetAside.js";
import { readFileSync } from "node:fs";

describe("C697 — the set-aside line", () => {
  it("the amount, its share of profit so far, and the quarterly payment", () => {
    const l = setAsideLine({ total: 9775, net: 50000, revenue: 120000, quarterly: 2443.75 });   // a share of PROFIT, not of sales
    expect(l.pct).toBe(20);
    expect(l.text).toBe("Keep about $9,775 aside for taxes on this year's profit so far — roughly 20% of it. Pay about $2,444 each quarter.");
  });
  it("nothing for a loss, no profit, or no tax", () => {
    expect(setAsideLine({ total: -2200, net: -10000 })).toBe(null);
    expect(setAsideLine({ total: 800, net: 0 })).toBe(null);
    expect(setAsideLine({ total: 0, net: 5000 })).toBe(null);
    expect(setAsideLine(null)).toBe(null);
  });
  it("no quarterly sentence when there's no quarterly payment", () => {
    expect(setAsideLine({ total: 500, net: 4000, quarterly: 0 }).text).not.toMatch(/each quarter/);
  });
});

describe("C697 — on Home, and the reminder refreshes with every input", () => {
  const src = readFileSync("src/components/views/DashboardView.jsx", "utf8");
  it("Home shows it with a door to Taxes", () => {
    expect(src).toMatch(/const setAside = setAsideLine\(taxEstimate\(invoices, yNow, 0,/);
    expect(src).toMatch(/data-set-aside/);
  });
  it("the deadline reminder's memo lists last year's answers, the equipment and the bank accounts", () => {
    expect(src).toMatch(/\}\), \[filedDeadlines, filedDeadlinesPrev, taxAssets, bankAccounts, cutoffDate, companySettings\?\.legalForm, invoices, contacts, CHART_OF_ACCOUNTS\]\);/);
  });
});
