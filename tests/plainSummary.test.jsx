// U4 / C379 — Reports opens with the period in plain words, read from the same derivations
// as the tables under it. Wording is a draft the operator edits; the properties are pinned.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { plainPeriodSummary } from "../src/lib/plainSummary.js";
import { computeRevenue, computeExpenses, glAccountBalance } from "../src/lib/reports.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";
import { renderViewHtml } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import ReportsView from "../src/components/views/ReportsView.jsx";

const led = POPULATED.invoices;
describe("plainPeriodSummary", () => {
  it("reads the table's own numbers and says profit or loss in plain words", () => {
    // the RANGE and the whole ledger differ, so the paragraph is proved to read the range
    const range = led.slice(0, Math.max(1, Math.floor(led.length / 2)));
    expect(computeExpenses(range)).not.toBe(computeExpenses(led));
    const r = plainPeriodSummary({ rangeInvoices: range, allInvoices: led, rangeLabel: "This Month", arCode: "1100", apCode: "2000" });
    expect(r.revenue).toBe(computeRevenue(range));
    expect(r.expenses).toBe(computeExpenses(range));
    expect(r.owed).toBe(glAccountBalance("1100", led));
    expect(r.owe).toBe(glAccountBalance("2000", led));
    expect(r.text).toMatch(/^In this month you brought in \$[\d,.]+ and spent \$[\d,.]+ — (a profit of|you spent \$[\d,.]+ more than you brought in|you broke even)/);
    expect(r.text).toMatch(/(Customers owe you|No customer owes you)/);
    expect([r.text, containsOwnerJargon(r.text)]).toEqual([r.text, false]);
  });
  it("an empty period says so, and a balance we were not handed is omitted (C309)", () => {
    const r = plainPeriodSummary({ rangeInvoices: [], allInvoices: led, rangeLabel: "Last Month" });
    expect(r.text).toBe("In last month, nothing has been recorded yet.");
    expect(r.owed).toBeNull(); expect(r.owe).toBeNull();
  });
  it("Reports renders it under the title, before the tables", () => {
    const html = renderViewHtml(ReportsView, { ...POPULATED, reportRange: "all", reportType: "pl" });
    const i = html.indexOf("data-plain-summary");
    expect(i).toBeGreaterThan(0);
    expect(html.slice(i, i + 1200)).toMatch(/Since the start you brought in/);
    const src = fs.readFileSync(path.join(process.cwd(), "src/components/views/ReportsView.jsx"), "utf8");
    expect(src.indexOf("data-plain-summary")).toBeLessThan(src.indexOf("{/* Controls */}"));
  });
});
