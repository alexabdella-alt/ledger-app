// C697 — Home says what to keep back for taxes, from the Taxes screen's estimate.
import { describe, it, expect } from "vitest";
import { setAsideLine } from "../src/lib/taxSetAside.js";
import { readFileSync } from "node:fs";

describe("C697 — the set-aside line", () => {
  it("the amount, its share of profit so far, and the quarterly payment", () => {
    const l = setAsideLine({ total: 9775, owed: 9775, net: 50000, taxableNet: 50000, revenue: 120000, quarterly: 2443.75, safeHarbor: { basis: "last_year" } });   // a share of PROFIT, not of sales
    expect(l.pct).toBe(20);
    expect(l.text).toBe("Keep about $9,775 aside for taxes on this year's profit so far — roughly 20% of the taxable profit. Pay about $2,444 each quarter.");
  });
  it("C701 — pay-as-you-go: less what's been paid, and 'by the next tax deadline', never 'each quarter' (the review's case)", () => {
    const l = setAsideLine({ total: 16000, owed: 4000, estPaid: 12000, net: 70000, taxableNet: 70000, quarterly: 4000, safeHarbor: { basis: "so_far" } });
    expect(l.text).toBe("Keep about $4,000 aside for taxes on this year's profit so far, after what you've already paid — roughly 23% of the taxable profit. Pay about $4,000 by the next tax deadline.");
    expect(l.text).not.toMatch(/each quarter/);
  });
  it("C701 — the share is of TAXABLE profit (meals and fines added back), never over 100%", () => {
    expect(setAsideLine({ total: 3000, owed: 3000, net: 2000, taxableNet: 12000, quarterly: 750, safeHarbor: { basis: "last_year" } }).pct).toBe(25);
    expect(setAsideLine({ total: 3000, owed: 3000, net: -500, taxableNet: 12000 })).not.toBe(null);
    expect(setAsideLine({ total: 3000, owed: 3000, net: 2000, taxableNet: 2000 }).pct).toBe(100);   // never "170% of it"
  });
  it("C701 — everything paid → nothing to keep aside", () => {
    expect(setAsideLine({ total: 5000, owed: 0, net: 30000, taxableNet: 30000 })).toBe(null);
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
    expect(src).toMatch(/const setAside = setAsideLine\(taxEstimate\(invoices, yNow, estPaidThisYear \|\| 0, \{/);
    expect(src).toMatch(/data-set-aside/);
  });
  it("the deadline reminder's memo lists last year's answers, the equipment and the bank accounts", () => {
    expect(src).toMatch(/\}\), \[filedDeadlines, filedDeadlinesPrev, taxAssets, bankAccounts, cutoffDate, estPaidThisYear, estPaidPrevYear, companySettings\?\.legalForm, invoices, contacts, CHART_OF_ACCOUNTS\]\);/);
  });
});
