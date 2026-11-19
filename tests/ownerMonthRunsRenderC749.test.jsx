import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MonthStatusView } from "../src/components/views/MonthStatus.jsx";
import { ownerMonthLines } from "../src/lib/completeness.js";

const m = (period, status, extra = {}) => ({ period, status, locked: false, items: [], ...extra });
describe("C749 — rendered and edge cases", () => {
  it("★★ the page draws one line for the run", () => {
    const months = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((p) => m(p, "unchecked")).concat(m("2026-11", "in_progress"));
    const h = renderToStaticMarkup(<MonthStatusView state={{ report: [{ status: "problem", months }] }} now={new Date(2026, 10, 18)} />).replace(/&#x27;/g, "'");
    expect((h.match(/data-month-line=/g) || []).length).toBe(1);   // C759 — the month in progress isn't mentioned
    expect(h).toContain("June – October 2026 — not checked against your bank yet. Drop those months' bank statements on Home.");
  });
  it("★★ same colour, different words: two lines", () => {
    const late = m("2026-10", "problem", { items: [{ kind: "statement_late", severity: "attention", text: "Chase's October 2026 statement isn't in yet." }] });
    const lines = ownerMonthLines([late, m("2026-09", "unchecked")]);
    expect(lines.map((l) => l.tone)).toEqual(["you", "you"]);
    expect(lines).toHaveLength(2);
  });
});
