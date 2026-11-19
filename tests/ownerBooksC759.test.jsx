// ★ C759 / C761 — what an owner sees of their months. Home asks (`need`); Reports says, in one line, how
// far the figures match the bank (`matchedThrough`); our team's process ("checking…") is never shown.
import { describe, it, expect } from "vitest";
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { ownerBooksStatus, matchedThrough, REPORTS_TRUST_COPY } from "../src/lib/completeness.js";
import { MonthStatusView } from "../src/components/views/MonthStatus.jsx";

const m = (period, status, extra = {}) => ({ period, status, locked: false, items: [], ...extra });
const partial = (p) => m(p, "attention", { items: [{ kind: "partial_statement", severity: "attention", text: "Primary Checking's statement covers part of the month." }] });
const missing = (p) => m(p, "attention", { items: [{ kind: "no_statement", severity: "attention", text: `No Primary Checking statement for ${p}.` }] });
const team = (p) => m(p, "problem", { items: [{ kind: "stuck", severity: "problem", text: "1 upload arrived and never reached the books." }] });
// The operator's screenshot, newest first: Nov (in progress, a problem), Oct–Sep missing, Aug team, Jul–Jun partial, May–Jan done/closed
const MONTHS = [team("2026-11"), missing("2026-10"), missing("2026-09"), team("2026-08"), partial("2026-07"), partial("2026-06"),
  m("2026-05", "complete"), m("2026-04", "complete", { locked: true }), m("2026-03", "complete"), m("2026-02", "complete"), m("2026-01", "complete")];
const NOW = new Date(2026, 10, 19);
const render = (months, onSeeHome = () => {}) =>
  renderToStaticMarkup(<MonthStatusView state={{ report: [{ status: "problem", months }] }} now={NOW} onSeeHome={onSeeHome} />).replace(/&#x27;/g, "'");

describe("C759 — what we need (asked for on Home)", () => {
  it("★★★ only what the owner can do, grouped into runs", () => {
    expect(ownerBooksStatus(MONTHS, { current: "2026-11" }).need.map((l) => l.text)).toEqual([
      "September – October 2026 — waiting for your Primary Checking statements. Drop them on Home.",
      "June – July 2026 — your Primary Checking statements only cover part of those months. Drop the rest on Home.",
    ]);
  });
  it("★★ the report lists months OLDEST first — the answer is the same either way", () => {
    expect(ownerBooksStatus([...MONTHS].reverse(), { current: "2026-11" })).toEqual(ownerBooksStatus(MONTHS, { current: "2026-11" }));
  });
});

describe("C761 — how far the books match the bank", () => {
  it("★★★ the last month of an unbroken run from the start (complete and closed alike)", () => {
    expect(matchedThrough(MONTHS, { current: "2026-11" })).toBe("2026-05");
  });
  it("★★★ a gap stops the run — 'through March' over a missing February would overstate it", () => {
    expect(matchedThrough([m("2026-01", "complete"), missing("2026-02"), m("2026-03", "complete")], { current: "2026-11" })).toBe("2026-01");
    expect(matchedThrough([missing("2026-01"), m("2026-02", "complete")], { current: "2026-11" })).toBeNull();
  });
  it("★★ the month in progress never counts; months before the books began are skipped", () => {
    expect(matchedThrough([m("2025-12", "before"), m("2026-10", "complete"), m("2026-11", "complete")], { current: "2026-11" })).toBe("2026-10");
  });
});

describe("C761 — Reports shows ONE line", () => {
  it("★★★ through May, and a pointer to Home because we need things — no list, no 'our team'", () => {
    const h = render(MONTHS);
    expect(h).toContain("Your books match your bank through May 2026.");
    expect(h).toContain(REPORTS_TRUST_COPY.needs);
    expect(h).toContain("See Home →");
    for (const gone of ["Your books</", "We need from you", "September", "our team", "Our team", "checking", "closed", "🔒", "Upload"]) expect(h).not.toContain(gone);
  });
  it("★★ nothing needed → just the line; nothing matched → it says so", () => {
    const h = render([m("2026-11", "in_progress"), m("2026-10", "complete"), m("2026-09", "complete", { locked: true })]);
    expect(h).toContain("Your books match your bank through October 2026.");
    expect(h).not.toContain("See Home");
    expect(render([missing("2026-10")])).toContain("Your books aren't matched to your bank yet.");
  });
  it("★★ loading or a failed read shows nothing — never a claim about a read that didn't happen", () => {
    expect(renderToStaticMarkup(<MonthStatusView state={{ loading: true }} />)).toBe("");
    expect(renderToStaticMarkup(<MonthStatusView state={{ loading: false, failed: ["x"] }} />)).toBe("");
  });
  it("★ the assistant's guide says the same thing", () => {
    const g = readFileSync("supabase/functions/ai-proxy/aiProfiles.js", "utf8");
    expect(g).toContain("one line says how far their books match their bank");
    expect(g).not.toContain("our team is still checking");
  });
});
