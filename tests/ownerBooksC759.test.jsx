// ★ C759 — "YOUR BOOKS": what we need from the owner, what matches the bank, what our team is still
// checking. No "closed", no "complete vs closed", no sign-off, nothing about the month not yet over.
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ownerBooksStatus, monthRangesText, OWNER_BOOKS_COPY } from "../src/lib/completeness.js";
import { MonthStatusView } from "../src/components/views/MonthStatus.jsx";

const m = (period, status, extra = {}) => ({ period, status, locked: false, items: [], ...extra });
const partial = (p) => m(p, "attention", { items: [{ kind: "partial_statement", severity: "attention", text: "Primary Checking's statement covers part of the month." }] });
const missing = (p) => m(p, "attention", { items: [{ kind: "no_statement", severity: "attention", text: `No Primary Checking statement for ${p}.` }] });
const team = (p) => m(p, "problem", { items: [{ kind: "stuck", severity: "problem", text: "1 upload arrived and never reached the books." }] });
// The operator's screenshot, newest first: Nov (in progress, a problem), Oct–Sep missing, Aug team, Jul–Jun partial, May–Jan done/closed
const MONTHS = [team("2026-11"), missing("2026-10"), missing("2026-09"), team("2026-08"), partial("2026-07"), partial("2026-06"),
  m("2026-05", "complete"), m("2026-04", "complete", { locked: true }), m("2026-03", "complete"), m("2026-02", "complete"), m("2026-01", "complete")];
const render = (months, now = new Date(2026, 10, 19), onUpload = () => {}) =>
  renderToStaticMarkup(<MonthStatusView state={{ report: [{ status: "problem", months }] }} now={now} onUpload={onUpload} />).replace(/&#x27;/g, "'");

describe("C759 — the owner's books, in two answers", () => {
  it("★★★ need: only what the owner can do, grouped; matched: complete AND closed together; reviewing: past months only", () => {
    const st = ownerBooksStatus(MONTHS, { current: "2026-11" });
    expect(st.need.map((l) => l.text)).toEqual([
      "September – October 2026 — waiting for your Primary Checking statements. Drop them on Home.",
      "June – July 2026 — your Primary Checking statements only covers part of the month. Drop the rest on Home.".replace("statements only covers", "statement only covers"),
    ]);
    expect(st.matched).toBe("January – May 2026");
    expect(st.reviewing).toBe("August 2026");   // not November — it isn't over
  });
  it("★★★ rendered: no 'closed', no 'complete', no 'finishing this month', nothing about November", () => {
    const h = render(MONTHS);
    expect(h).toContain("Your books");
    expect(h).toContain("We need from you");
    expect(h).toContain("Matched to your bank: January – May 2026.");
    expect(h).toContain("Our team is checking August 2026 — nothing needed from you.");
    expect(h).toContain("Upload on Home →");
    for (const gone of ["closed", "🔒", "complete", "finishing this month", "November", "Your months", "to the penny"]) expect(h).not.toContain(gone);
  });
  it("★★ nothing needed → it says so, and offers no upload button", () => {
    const h = render([m("2026-11", "in_progress"), m("2026-10", "complete"), m("2026-09", "complete", { locked: true })]);
    expect(h).toContain(OWNER_BOOKS_COPY.nothing);
    expect(h).toContain("Matched to your bank: September – October 2026.");
    expect(h).not.toContain("data-books-upload");
  });
  it("★ only the month in progress → no card at all (nothing to say yet)", () => {
    expect(render([m("2026-11", "in_progress")])).toBe("");
  });
  it("★★ the report lists months OLDEST first — the result is the same either way", () => {
    const a = ownerBooksStatus(MONTHS, { current: "2026-11" });
    const b = ownerBooksStatus([...MONTHS].reverse(), { current: "2026-11" });
    expect(b).toEqual(a);
    expect(b.need).toHaveLength(2);
  });
  it("★ ranges: runs, gaps and year ends", () => {
    expect(monthRangesText(["2026-01", "2026-02", "2026-03"])).toBe("January – March 2026");
    expect(monthRangesText(["2026-01", "2026-03"])).toBe("January 2026 and March 2026");
    expect(monthRangesText(["2025-11", "2025-12", "2026-01", "2026-05", "2026-07"])).toBe("November 2025 – January 2026, May 2026 and July 2026");
    expect(monthRangesText([])).toBe("");
  });
});
