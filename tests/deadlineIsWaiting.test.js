import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { deadlineIsWaiting, getTaxDeadlines } from "../src/lib/tax.js";

// C434 — an estimated-payment deadline is waiting only when there is something to pay;
// filing deadlines always are. A brand-new company was told "Pay your 3rd-quarter estimated
// taxes" on day one, and would have been every quarter.
describe("deadlineIsWaiting", () => {
  const est = getTaxDeadlines(new Date(2026, 8, 1)).find((d) => d.est);
  const filing = getTaxDeadlines(new Date(2026, 2, 1)).find((d) => !d.est && d.kind !== "1099");
  it("an estimated payment with nothing to pay is not waiting; with an estimate it is", () => {
    expect(deadlineIsWaiting(est, { total: 0 })).toBe(false);
    expect(deadlineIsWaiting(est, null)).toBe(false);
    expect(deadlineIsWaiting(est, { total: 1200 })).toBe(true);
  });
  it("★ a 1099 filing deadline waits only when the plan names someone to file for (C435)", () => {
    const d1099 = getTaxDeadlines(new Date(2026, 0, 5)).find((d) => d.kind === "1099");
    expect(d1099).toBeTruthy();
    expect(deadlineIsWaiting(d1099, null, { has1099s: false })).toBe(false);
    expect(deadlineIsWaiting(d1099, null, { has1099s: true })).toBe(true);
    expect(getTaxDeadlines(new Date(2026, 0, 5)).filter((d) => d.kind === "1099")).toHaveLength(3);
  });
  it("a filing deadline is waiting regardless of the estimate — it is about a form, not an amount", () => {
    expect(deadlineIsWaiting(filing, { total: 0 })).toBe(true);
    expect(deadlineIsWaiting(filing, null)).toBe(true);
  });
  it("Home and the bell both read it", () => {
    const home = fs.readFileSync("src/components/views/DashboardView.jsx", "utf8");
    const app = fs.readFileSync("src/App.jsx", "utf8");
    expect(home).toMatch(/const dl = deadlineIsWaiting\(dl0, est, \{ has1099s \}\) \? dl0 : null;/);
    expect(app).toMatch(/const nextDue = deadlineIsWaiting\(nextDue0, est, \{ has1099s \}\) \? nextDue0 : null;/);
  });
});
