import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { nextRecurringDate, isMonthEnd } from "../src/lib/recurringSchedule.js";

// ═════════════════════════════════════════════════════════════════════════════
// C492 — A RECURRING CHARGE DUE ON THE 31st SKIPPED FEBRUARY. The Recurring screen
// advanced `next_date` with `setMonth(+1)`: Jan 31 → "Feb 31" → Mar 3, so a month-end rent
// was never offered for February and the rule drifted onto the 3rd. The date advances
// through one pure function now, which neither overflows nor parks a month-end rule on the
// 28th forever.
// ═════════════════════════════════════════════════════════════════════════════
describe("C492 · nextRecurringDate", () => {
  it("the shipped expression skipped a month — demonstrated, not asserted", () => {
    const next = new Date("2026-01-31T00:00:00"); next.setMonth(next.getMonth() + 1);
    expect(next.getMonth()).toBe(2);   // March, not February
  });
  it("monthly from a month-end stays on month-ends through the year", () => {
    let d = "2026-01-31"; const seen = [];
    for (let i = 0; i < 12; i++) { d = nextRecurringDate(d, "monthly"); seen.push(d); }
    expect(seen).toEqual(["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30", "2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31"]);
  });
  it("a mid-month day keeps its day; a leap February is honoured", () => {
    expect(nextRecurringDate("2026-01-15", "monthly")).toBe("2026-02-15");
    expect(nextRecurringDate("2028-01-31", "monthly")).toBe("2028-02-29");
    expect(nextRecurringDate("2028-02-29", "monthly")).toBe("2028-03-31");
  });
  it("quarterly and annual clamp the same way; weekly is seven days", () => {
    expect(nextRecurringDate("2026-11-30", "quarterly")).toBe("2027-02-28");   // raw setMonth gave Mar 2
    expect(nextRecurringDate("2026-08-15", "quarterly")).toBe("2026-11-15");
    expect(nextRecurringDate("2028-02-29", "annual")).toBe("2029-02-28");
    expect(nextRecurringDate("2026-12-28", "weekly")).toBe("2027-01-04");
  });
  it("an unknown frequency or a bad date yields null, never a guess", () => {
    expect(nextRecurringDate("2026-01-31", "fortnightly")).toBeNull();
    expect(nextRecurringDate("31/01/2026", "monthly")).toBeNull();
    expect(isMonthEnd("2026-02-28")).toBe(true);
    expect(isMonthEnd("2026-02-27")).toBe(false);
  });
  it("the Recurring screen advances through it and no raw setMonth remains in a view", () => {
    const src = fs.readFileSync("src/components/views/RecurringView.jsx", "utf8").replace(/^[ \t]*\/\/.*$/gm, "");
    expect(src).toMatch(/\n\s*const nextDate = nextRecurringDate\(r\.next_date, r\.frequency\)/);
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
    for (const f of walk("src/components")) {
      const t = fs.readFileSync(f, "utf8").replace(/^[ \t]*\/\/.*$/gm, "");
      expect(t, f).not.toMatch(/\.setMonth\(|\.setFullYear\(/);
    }
  });
});
