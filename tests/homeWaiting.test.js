import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { homeWaitingList } from "../src/lib/homeWaiting";

// C675 — bills coming due in the next seven days.
import { dueSoonCopy } from "../src/lib/homeWaiting";
describe("★ C675 — Home names bills due in the next 7 days", () => {
  const due = [{ vendor: "Rent LLC", amount: 2000, due_date: "2026-11-20" }, { vendor: "Adobe", amount: 59.99, due_date: "2026-11-16" }];
  it("the soonest is named, with the total", () => {
    const item = homeWaitingList({ dueSoonBills: due }).find((i) => i.id === "bills_due_soon");
    expect(item.text).toBe("2 bills are due in the next 7 days ($2,059.99). Next: Adobe, $59.99, due Mon Nov 16.");
    expect(item.actions[0]).toEqual({ kind: "nav", label: "Pay or mark paid", view: "ap" });
  });
  it("one bill reads naturally", () => {
    expect(dueSoonCopy({ n: 1, total: 59.99, next: due[1] })).toBe("1 bill is due in the next 7 days ($59.99). It's Adobe, $59.99, due Mon Nov 16.");
  });
  it("nothing due, nothing said", () => {
    expect(homeWaitingList({ dueSoonBills: [] }).some((i) => i.id === "bills_due_soon")).toBe(false);
  });
  it("Home passes the next seven days of open bills (not the overdue ones)", () => {
    const src = readFileSync("src/components/views/DashboardView.jsx", "utf8");
    expect(src).toMatch(/const dueSoonBills = unpaid\.filter\(i => i\.due_date && i\.due_date >= today && i\.due_date <= weekOut\);/);
  });
});
