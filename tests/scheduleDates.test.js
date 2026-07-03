import { describe, it, expect } from "vitest";
import { addMonthsClampedYMD, ymdLocal } from "../src/lib/format.js";
import { buildDepreciationSchedule } from "../src/lib/depreciation.js";
import { buildPrepaidSchedule } from "../src/lib/prepaid.js";

// ════════════════════════════════════════════════════════════════════════════
// CR-4 — amortization / depreciation schedule date math. Two bugs, one fix:
//   (a) MONTH OVERFLOW — new Date(y, m+k, 31) for a short target month rolls
//       forward (Feb 31 → Mar 3), skipping the month entirely.
//   (b) toISOString() UTC day-shift for non-UTC users.
// addMonthsClampedYMD clamps the day to the target month's last day and formats
// from LOCAL components. These tests pin the Jan-31 / Feb boundary.
// ════════════════════════════════════════════════════════════════════════════

describe("addMonthsClampedYMD — clamps to the target month, no overflow, local format", () => {
  it("Jan 31 +1 month → Feb 28 (2026, non-leap) — NOT Mar 3", () => {
    expect(addMonthsClampedYMD("2026-01-31", 1)).toBe("2026-02-28");
  });
  it("Jan 31 +1 month → Feb 29 in a leap year (2028)", () => {
    expect(addMonthsClampedYMD("2028-01-31", 1)).toBe("2028-02-29");
  });
  it("Jan 31 across four months lands on each month's real last/28th, never overflows", () => {
    expect([0, 1, 2, 3, 4].map(k => addMonthsClampedYMD("2026-01-31", k)))
      .toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  });
  it("Mar 31 +1 → Apr 30 (30-day month clamp)", () => {
    expect(addMonthsClampedYMD("2026-03-31", 1)).toBe("2026-04-30");
  });
  it("Dec 15 +1 rolls the YEAR correctly", () => {
    expect(addMonthsClampedYMD("2026-12-15", 1)).toBe("2027-01-15");
  });
  it("mid-month days are untouched", () => {
    expect(addMonthsClampedYMD("2026-01-15", 2)).toBe("2026-03-15");
  });
  it("k=0 returns the start date unchanged", () => {
    expect(addMonthsClampedYMD("2026-01-31", 0)).toBe("2026-01-31");
  });
});

describe("buildDepreciationSchedule — month boundary correct (Jan 31 in-service)", () => {
  const s = buildDepreciationSchedule({
    cost: 1200, salvage: 0, lifeMonths: 4, inServiceDate: "2026-01-31",
    depExpCode: "6900", accumDepCode: "1510", assetLabel: "Laptop", assetId: "a1",
  });
  it("posts exactly `lifeMonths` entries on clamped month-end dates — Feb is NOT skipped", () => {
    expect(s.entries.map(e => e.date)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });
  it("sums to the depreciable base exactly (last month absorbs rounding)", () => {
    const total = s.entries.reduce((a, e) => a + e.lines.reduce((x, l) => x + (l.debit || 0), 0), 0);
    // each entry Dr 6900 / Cr 1510 — sum the debits
    expect(Math.round(total * 100) / 100).toBe(1200);
  });
});

describe("buildPrepaidSchedule — same clamp (Jan 31 start)", () => {
  const s = buildPrepaidSchedule({
    total: 1200, months: 3, startDate: "2026-01-31",
    expenseCode: "6700", prepaidCode: "1400", label: "Insurance",
  });
  it("amortizes on clamped month-ends, no Feb skip", () => {
    expect(s.entries.map(e => e.date)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });
});

describe("ymdLocal — formats from local components (no toISOString)", () => {
  it("returns the local calendar Y-M-D of a Date", () => {
    const d = new Date(2026, 0, 31);   // Jan 31 local
    expect(ymdLocal(d)).toBe("2026-01-31");
  });
});
