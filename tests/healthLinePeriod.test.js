import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { businessHealth } from "../src/lib/reports";

// C621 — review finding R10: the monthly report's health line used a different period.
const row = (id, date, amount, gl_code) => ({ id, vendor: "X", date, amount, gl_code, debit_credit: gl_code[0] === "4" ? "credit" : "debit", status: "booked" });
const ledger = [row(1, "2026-02-10", 5000, "4100"), row(2, "2026-03-10", 1000, "6250"), row(3, "2026-07-10", 9000, "6250")];
const profit = (bh) => (bh.facts || []).concat(bh.ownerFacts || []).find((f) => f.key === "profit")?.value;

describe("the health line stops at its own date", () => {
  it("★ a report for March does not count July", () => {
    const bh = businessHealth(ledger, { cash: 10000, now: new Date(2026, 2, 31, 12) });
    expect(profit(bh)).toMatch(/4,000\.00/);   // 5,000 − 1,000; July's 9,000 is after the report
  });

  it("★ a burn the caller already worked out is the one used", () => {
    const a = businessHealth(ledger, { cash: 10000, now: new Date(2026, 2, 31, 12), burn: 1234 });
    expect(JSON.stringify(a)).toMatch(/1,234/);
  });

  it("the monthly report passes its own burn", () => {
    const src = readFileSync("src/lib/reports.js", "utf8");
    expect(src).toMatch(/const bh = businessHealth\(live, \{ cash, now: monthEnd, burn \}\);/);
  });
});
