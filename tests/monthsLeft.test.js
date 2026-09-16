import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { monthsLeftYMD } from "../src/lib/format.js";

// C502 — Home's commitments card computed "months left" on a lease as ceil(days / 30) over a
// UTC-midnight parse, so a 12-month lease read "13 months left". Calendar months, from the strings.
describe("C502 · monthsLeftYMD", () => {
  it("a twelve-month lease has 12 months left, not 13", () => {
    expect(monthsLeftYMD("2026-09-15", "2027-09-14")).toBe(12);
    expect(monthsLeftYMD("2026-09-15", "2027-09-15")).toBe(12);
    expect(monthsLeftYMD("2026-09-15", "2027-09-16")).toBe(13);
  });
  it("this month, a past end, and a partial month", () => {
    expect(monthsLeftYMD("2026-09-15", "2026-09-30")).toBe(1);
    expect(monthsLeftYMD("2026-09-15", "2026-09-10")).toBe(0);
    expect(monthsLeftYMD("2026-09-15", "2026-12-31")).toBe(4);
    expect(monthsLeftYMD("2026-01-31", "2026-02-28")).toBe(1);
    expect(monthsLeftYMD("2026-09-15", "")).toBeNull();
  });
  it("the shipped expression — demonstrated: 365 days is 13 by ceil(days/30)", () => {
    expect(Math.ceil(365 / 30)).toBe(13);
  });
  it("Home's card reads it", () => {
    const src = fs.readFileSync("src/components/views/DashboardView.jsx", "utf8").replace(/^[ \t]*\/\/.*$/gm, "");
    expect(src).toMatch(/const monthsLeft = \(c\) => c\.end_date \? monthsLeftYMD\(todayLocal\(\), c\.end_date\) : null;/);
    expect(src).not.toMatch(/86400000\*30/);
  });
});
