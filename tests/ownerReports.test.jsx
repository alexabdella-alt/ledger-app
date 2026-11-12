import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ownerReportTabs, OWNER_REPORT_TABS, OWNER_MORE_REPORT_TABS, reportTabsFor, REPORT_GUIDE } from "../src/lib/reportGuide";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED, ACCOUNTS } from "./helpers/populatedFixture.js";
import ReportsView from "../src/components/views/ReportsView.jsx";
import { CLIENT_VIEW_IDS, ALL_VIEW_IDS } from "../src/lib/nav.js";

// C640 — the owner's Reports: four in an owner's words; the rest behind "More reports".
describe("the owner's report tabs", () => {
  it("★ four everyday reports, named plainly", () => {
    expect(ownerReportTabs().map(([, l]) => l)).toEqual(["Profit & loss", "Where the money goes", "Who you pay", "Cash in and out"]);
  });
  it("★ 'More reports' opens the rest; none of the owner's old reports is lost", () => {
    const all = ownerReportTabs({ showMore: true }).map(([id]) => id);
    for (const [id] of reportTabsFor({ reviewer: false })) expect([id, all.includes(id)]).toEqual([id, true]);
  });
  it("a report opened from elsewhere is shown as a tab even with More closed", () => {
    expect(ownerReportTabs({ current: "balance" }).map(([id]) => id)).toContain("balance");
    expect(ownerReportTabs({ current: "pl" })).toHaveLength(4);
  });
  it("every owner tab has its one-line explanation", () => {
    for (const [id] of [...OWNER_REPORT_TABS, ...OWNER_MORE_REPORT_TABS]) expect([id, !!REPORT_GUIDE[id]]).toEqual([id, true]);
  });
  it("the accountant keeps every tab, with the accounting names", () => {
    expect(reportTabsFor({ reviewer: true }).map(([id]) => id)).toContain("trial");
    expect(reportTabsFor({ reviewer: true }).find(([id]) => id === "balance")[1]).toBe("Balance Sheet");
  });
});

describe("the page", () => {
  const ctx = (seat, extra = {}) => ({ ...POPULATED, ...(VIEW_CONTEXT["ReportsView.jsx"] || {}), CHART_OF_ACCOUNTS: ACCOUNTS, BOOKABLE_ACCOUNTS: ACCOUNTS, navSeat: seat, companyDataLoaded: true, reportType: "pl", reportRange: "thismonth", ...extra });
  const owner = { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS };
  const cpa = { seat: "reviewer", isReviewerSeat: true, sections: [], viewIds: ALL_VIEW_IDS };
  it("★ an owner sees the four, a More reports button, and no date boxes until Custom", () => {
    const html = renderViewHtml(ReportsView, ctx(owner));
    for (const [, l] of OWNER_REPORT_TABS) expect(html).toContain(`>${l.replace("&", "&amp;")}<`);
    expect(html).toContain("More reports ▾");
    expect(html).not.toContain(">Balance Sheet<");
    expect(html).not.toContain('type="date"');
    expect(renderViewHtml(ReportsView, ctx(owner, { reportRange: "custom" }))).toContain('type="date"');
  });
  it("★ the owner's Profit & loss and 'What you own and owe' show category names, not account numbers", () => {
    // The balance report renders no rows from this sample company; its two number badges are pinned in the source below.
    const src = readFileSync("src/components/views/ReportsView.jsx", "utf8");
    expect((src.match(/\{!ownerSeat && <span style=\{\{color:"var\(--sc-text-mut\)",marginRight:8,fontFamily:"monospace",fontSize:11\}\}>\{a\.code\}<\/span>\}/g) || []).length).toBe(2);
    for (const reportType of ["pl", "gl"]) {   // gl = "Where the money goes" (it printed "6000 · Salaries" to owners)
      const o = renderViewHtml(ReportsView, ctx(owner, { reportType, reportRange: "all" }));
      const c = renderViewHtml(ReportsView, ctx(cpa, { reportType, reportRange: "all" }));
      const codeBadges = (h) => (h.match(/>[1-8]\d{3}(?:<| ·)/g) || []).length;
      expect([reportType, codeBadges(c) > 0]).toEqual([reportType, true]);   // the accountant sees them — so the check has something to find
      expect([reportType, codeBadges(o)]).toEqual([reportType, 0]);
    }
  });
  it("the accountant's page is unchanged: every tab and the date boxes", () => {
    const html = renderViewHtml(ReportsView, ctx(cpa));
    expect(html).toContain(">Balance Sheet<");
    expect(html).toContain('type="date"');
    expect(html).not.toContain("More reports ▾");
  });
});
