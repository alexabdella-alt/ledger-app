import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { reportTabsFor, REPORT_GUIDE, BASIS_LABELS, REPORTS_PURPOSE } from "../src/lib/reportGuide.js";
import { renderViewHtml } from "./helpers/renderView.jsx";
import ReportsView from "../src/components/views/ReportsView.jsx";

const text = (h) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const JARGON = /\b(accrual|GAAP|debit|credit|trial balance|KPIs?|P&L)\b/i;

describe("C576 — Reports say what each one is for, in an owner's words", () => {
  it("an owner's tabs leave out the accountant's trial balance; the accountant keeps it", () => {
    const owner = reportTabsFor({ reviewer: false }).map(([id]) => id);
    expect(owner).not.toContain("trial");
    expect(reportTabsFor({ reviewer: true }).map(([id]) => id)).toContain("trial");
  });
  it("tab names and every guide line are free of accounting jargon", () => {
    for (const [, label] of reportTabsFor({ reviewer: false })) expect(label).not.toMatch(JARGON);
    for (const id of reportTabsFor({ reviewer: false }).map(([i]) => i)) {
      expect(REPORT_GUIDE[id], id).toBeTruthy();
      expect(REPORT_GUIDE[id], id).not.toMatch(JARGON);
    }
    expect(BASIS_LABELS.accrual.button).toBe("When billed");
    expect(BASIS_LABELS.cash.button).toBe("When paid");
  });
  it("an owner with nothing yet is told how reports fill in, with a way to Home", () => {
    const t = text(renderViewHtml(ReportsView, { navSeat: { isReviewerSeat: false }, invoices: [], reportType: "pl", companyDataLoaded: true }));
    expect(t).toContain(REPORTS_PURPOSE);
    expect(t).toMatch(/Go to Home to upload →/);
    expect(t).toContain(REPORT_GUIDE.pl);
    expect(t).not.toMatch(/All account balances/);
  });
  it("the accountant still sees the trial balance tab", () => {
    const t = text(renderViewHtml(ReportsView, { navSeat: { isReviewerSeat: true }, invoices: [], reportType: "pl", companyDataLoaded: true }));
    expect(t).toMatch(/All account balances/);
  });
  it("the unpaid-bills report no longer records a payment without asking", () => {
    const src = readFileSync("src/components/views/ReportsView.jsx", "utf8");
    expect(src).not.toMatch(/markPaid\(r\.id, "ach"/);
  });
});
