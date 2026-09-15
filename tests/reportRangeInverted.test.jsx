import { describe, it, expect } from "vitest";
import { renderViewHtml } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import ReportsView from "../src/components/views/ReportsView.jsx";
// C441 — an inverted custom range says so instead of reading "$0.00".
describe("C441", () => {
  it("says the start is after the end; silent when the range is sane", () => {
    const base = { ...POPULATED, companyDataLoaded: true, signoffsLoadOk: true, reportRange: "custom" };
    expect(renderViewHtml(ReportsView, { ...base, reportDateFrom: "2026-09-30", reportDateTo: "2026-09-01" })).toContain("data-range-inverted");
    expect(renderViewHtml(ReportsView, { ...base, reportDateFrom: "2026-09-01", reportDateTo: "2026-09-30" })).not.toContain("data-range-inverted");
  });
});
