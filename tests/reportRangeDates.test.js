import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { reportRangeDates } from "../src/lib/reportRange";

// C645 — the range picker sets the dates the balance sheet reads, for every range.
const now = new Date(2026, 10, 12);   // 12 Nov 2026, local
describe("the dates a range choice sets", () => {
  it("★ last month: its first and last day — the balance sheet is as of October 31", () => {
    expect(reportRangeDates("lastmonth", now)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });
  it("★ a past quarter ends on its last day", () => {
    expect(reportRangeDates("q2", now)).toEqual({ from: "2026-04-01", to: "2026-06-30" });
  });
  it("★ a range still running ends today, never a day that hasn't happened", () => {
    expect(reportRangeDates("q4", now)).toEqual({ from: "2026-10-01", to: "2026-11-12" });
    expect(reportRangeDates("thismonth", now)).toEqual({ from: "2026-11-01", to: "2026-11-12" });
    expect(reportRangeDates("ytd", now)).toEqual({ from: "2026-01-01", to: "2026-11-12" });
  });
  it("January's 'last month' is the previous December", () => {
    expect(reportRangeDates("lastmonth", new Date(2027, 0, 5))).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
  it("all clears both; custom leaves what the person typed", () => {
    expect(reportRangeDates("all", now)).toEqual({ from: "", to: "" });
    expect(reportRangeDates("custom", now)).toBe(null);
  });
  it("the picker uses it for every choice", () => {
    const src = readFileSync("src/components/views/ReportsView.jsx", "utf8");
    expect(src).toMatch(/setReportRange\(e\.target\.value\); const d = reportRangeDates\(e\.target\.value, new Date\(\), \{ fiscalYearEnd: fyEnd \}\); if \(d\) \{ setReportDateFrom\(d\.from\); setReportDateTo\(d\.to\); \}/);
  });
});
