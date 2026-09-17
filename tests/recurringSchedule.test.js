import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { nextRecurringDate, isMonthEnd } from "../src/lib/recurringSchedule.js";
import { RECURRING_FREQUENCIES } from "../src/lib/chatActions.js";

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

import { dueLabel } from "../src/lib/recurringSchedule.js";
import { renderViewHtml } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import RecurringView from "../src/components/views/RecurringView.jsx";
import { todayLocal, addDaysYMD } from "../src/lib/format.js";

describe("C495 · dueLabel", () => {
  it("says how long a rule has been due, not 'today' for everything past", () => {
    expect(dueLabel("2026-09-15", "2026-09-15")).toBe("Due today");
    expect(dueLabel("2026-09-14", "2026-09-15")).toBe("Due yesterday");
    expect(dueLabel("2026-09-05", "2026-09-15")).toBe("Due 10 days ago");
    expect(dueLabel("2026-08-25", "2026-09-15")).toBe("Due 3 weeks ago");
    expect(dueLabel("2026-06-15", "2026-09-15")).toBe("Due 3 months ago");
    expect(dueLabel("2026-09-16", "2026-09-15")).toBeNull();
  });
  it("the Recurring screen renders it for an overdue rule", () => {
    const today = todayLocal();
    const recurring = [{ id: "r1", name: "Rent", vendor: "Franklin Ave", amount: 2400, gl_code: "6100", gl_name: "Rent", frequency: "monthly", next_date: addDaysYMD(today, -21), active: true }];
    const t = renderViewHtml(RecurringView, { ...POPULATED, recurring, companyDataLoaded: true }).replace(/<!-- -->/g, "");
    expect(t).toContain("Due 3 weeks ago");
    expect(t).not.toContain("Due today");
  });
});

// C533 — the frequency vocabulary is one set in four places: the DB CHECK, the writer's allow-list,
// the form's options and the scheduler. A frequency the scheduler does not know returns null and
// the rule is "left alone" — i.e. never advances, which is C525's shape by another door.
describe("C533 — every allowed recurring frequency advances", () => {
  const ddl = fs.readFileSync("supabase/migrations/000_baseline_schema.sql", "utf8");
  const m = ddl.match(/recurring_transactions_frequency_check CHECK \(\(frequency = ANY \(ARRAY\[(.*?)\]\)\)\)/);
  const dbSet = m[1].match(/'([a-z]+)'/g).map(s => s.replace(/'/g, "")).sort();
  it("the writer's allow-list is exactly the DB's CHECK set", () => {
    expect([...RECURRING_FREQUENCIES].sort()).toEqual(dbSet);
  });
  it("the scheduler advances every one of them, and the form offers every one", () => {
    for (const f of dbSet) expect(nextRecurringDate("2026-01-31", f), f).not.toBeNull();
    const view = fs.readFileSync("src/components/views/RecurringView.jsx", "utf8");
    for (const f of dbSet) expect(view).toContain(`"${f}"`);
  });
});
