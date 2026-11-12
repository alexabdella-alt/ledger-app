import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { nextRecurringDate } from "../src/lib/recurringSchedule";
import { detectRecurringPatterns } from "../src/lib/insights";

// C612 — review finding F10.
describe("a recurring charge is posted on its own date", () => {
  it("★ the entry is dated at the occurrence it records, not the day Post was pressed", () => {
    const v = readFileSync("src/components/views/RecurringView.jsx", "utf8");
    const fn = v.slice(v.indexOf("const runRecurringOnce = async"), v.indexOf("setInvoices(prev => [inv, ...prev]);", v.indexOf("const runRecurringOnce = async")));
    expect(fn).toMatch(/amount:r\.amount, date:r\.next_date \|\| today, type:"expense",/);
    expect(fn).not.toMatch(/date:today,/);
  });
});

describe("an accepted suggestion starts after what is already booked", () => {
  it("★ next date = the occurrence after the last booked charge, falling back to today only without one", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/frequency: "monthly", next_date: \(s\.lastDate && nextRecurringDate\(s\.lastDate, "monthly"\)\) \|\| todayLocal\(\), project: "General",/);
  });

  it("the suggestion carries the last booked date it is computed from", () => {
    const now = new Date("2026-04-20T12:00:00");
    const rows = ["2026-01-03", "2026-02-03", "2026-03-03", "2026-04-03"].map((d, i) => ({ id: `r${i}`, vendor: "Adobe", amount: 54.99, date: d, gl_code: "6500", gl_name: "Software", type: "expense", status: "booked" }));
    const s = detectRecurringPatterns(rows, [], now).find((x) => /adobe/i.test(x.vendor));
    expect(s?.lastDate).toBe("2026-04-03");
    expect(nextRecurringDate(s.lastDate, "monthly")).toBe("2026-05-03");   // not "due" on April 20
  });
});
