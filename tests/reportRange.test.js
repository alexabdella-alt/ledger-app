import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { inReportRange, reportRangeBounds } from "../src/lib/reportRange.js";

// ═════════════════════════════════════════════════════════════════════════════
// C440 — THE FIRST OF EVERY MONTH FELL INTO THE PREVIOUS MONTH ON REPORTS, FROM ANY US ZONE.
// `new Date("2026-09-01").getMonth()` is 7 in Chicago. Decided on the string now.
// ═════════════════════════════════════════════════════════════════════════════
const sep15 = new Date(2026, 8, 15, 12);   // local Sep 15

describe("inReportRange", () => {
  it("★ the first of the month is in THIS month — from every zone (the string decides)", () => {
    expect(inReportRange("2026-09-01", "thismonth", { now: sep15 })).toBe(true);
    expect(inReportRange("2026-09-01", "lastmonth", { now: sep15 })).toBe(false);
    expect(inReportRange("2026-08-31", "lastmonth", { now: sep15 })).toBe(true);
    expect(inReportRange("2026-08-01", "lastmonth", { now: sep15 })).toBe(true);
  });
  it("★ and the OLD expression gets it wrong in a US zone — the demonstration, not an assumption", () => {
    const tz = process.env.TZ; process.env.TZ = "America/Chicago";
    try {
      const d = new Date("2026-09-01");
      if (d.getTimezoneOffset() > 0) expect(d.getMonth()).toBe(7);   // August, from Chicago
      else expect(true).toBe(true);   // the runtime ignored TZ (CI in UTC) — the string test above still holds
    } finally { process.env.TZ = tz; }
  });
  it("quarters, year to date, January's last-month wraps the year, custom is inclusive", () => {
    expect(inReportRange("2026-07-01", "q3", { now: sep15 })).toBe(true);
    expect(inReportRange("2026-10-01", "q3", { now: sep15 })).toBe(false);
    expect(inReportRange("2026-01-01", "ytd", { now: sep15 })).toBe(true);
    expect(inReportRange("2025-12-31", "ytd", { now: sep15 })).toBe(false);
    expect(reportRangeBounds("lastmonth", new Date(2026, 0, 10))).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(inReportRange("2026-03-01", "custom", { from: "2026-03-01", to: "2026-03-31" })).toBe(true);
    expect(inReportRange("2026-04-01", "custom", { from: "2026-03-01", to: "2026-03-31" })).toBe(false);
    expect(inReportRange("2026-04-01", "custom", { from: "2026-03-01", to: "" })).toBe(true);
    expect(inReportRange("", "thismonth", { now: sep15 })).toBe(false);
    expect(inReportRange("2026-04-01", "all")).toBe(true);
  });
  it("★ src-wide: no local getter is read off a Date parsed from an entry's date string", () => {
    const path = require("node:path");
    const walk = (d) => fs.readdirSync(d).flatMap((f) => { const p = path.join(d, f); return fs.statSync(p).isDirectory() ? walk(p) : /\.jsx?$/.test(f) ? [p] : []; });
    const bad = [];
    for (const f of walk("src")) {
      const src = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
      for (const m of src.matchAll(/new Date\([\w.?]+\.(date|due_date|entry_date|document_date|paid_at|next_date)\)\.get(Month|Date|FullYear|Day)\(\)/g)) bad.push(`${f}: ${m[0]}`);
    }
    expect(bad).toEqual([]);
  });
  it("Reports reads it, and no getMonth() on a parsed entry date remains there", () => {
    const src = fs.readFileSync("src/components/views/ReportsView.jsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
    expect(src).toMatch(/const filterByRange = \(invList\) => invList\.filter\(inv => inReportRange\(inv\.date, reportRange, \{ from: reportDateFrom, to: reportDateTo \}\)\);/);
    expect(src).not.toMatch(/new Date\(inv\.date\)/);
  });
});
