import { describe, it, expect } from "vitest";
import { businessHealth, computeBurnRate, burnRateDetail } from "../src/lib/reports.js";
import { fmtSignedMoney } from "../src/lib/format.js";

// ════════════════════════════════════════════════════════════════════════════
// Dashboard "Monthly burn" (and the runway that divides by it) =
//   average expense over the trailing 3 COMPLETE calendar months, where
//   • the current PARTIAL month is excluded,
//   • the window is a FIXED 3-month span (empty month = $0, divide by the span —
//     it never reaches back to inflate),
//   • one-off SPIKE months (> 3× the window median) are dropped,
//   • a company with <3 complete months divides by what it has.
// This is the single definition shared by the card, the runway, and the AI, and
// the breakdown drill renders burnRateDetail().window so it reconciles to the value.
// ════════════════════════════════════════════════════════════════════════════

const exp = (id, date, amt) => ({ id, gl_code: "6000", secondary_gl_code: "1000", amount: amt, debit_credit: "debit", date, type: "expense" });
const NOW = new Date(2026, 3, 15);   // Apr 15 2026, local — current (partial) month = 2026-04
const burnFact = (bh) => bh.facts.find((f) => f.key === "burn").value;

describe("Monthly burn = trailing-3-complete-month average", () => {
  // Three full months of ~$3,000, plus ONE small $100 item in the current partial month.
  const FIX = [
    exp("a", "2026-01-10", 3000),
    exp("b", "2026-02-10", 3000),
    exp("c", "2026-03-10", 3000),
    exp("d", "2026-04-05", 100),   // current partial month — must be EXCLUDED
  ];

  it("excludes the current partial month (Jan+Feb+Mar)/3 = 3000, not the $100 item", () => {
    expect(computeBurnRate(FIX, { asOf: "2026-04-15" })).toBe(3000);
  });

  it("does NOT collapse to the single most-recent expense", () => {
    expect(burnFact(businessHealth(FIX, { cash: 10000, now: NOW }))).not.toBe(fmtSignedMoney(100));
    expect(burnFact(businessHealth(FIX, { cash: 10000, now: NOW }))).toBe(fmtSignedMoney(3000));
  });

  it("card === the canonical scalar the runway uses", () => {
    const bh = businessHealth(FIX, { cash: 10000, now: NOW });
    expect(burnFact(bh)).toBe(fmtSignedMoney(computeBurnRate(FIX, { asOf: "2026-04-15" })));
  });

  it("an empty month inside the window counts as $0 (fixed span, no reach-back)", () => {
    // Feb has no spend; window Jan/Feb/Mar = (3000 + 0 + 3000)/3 = 2000.
    const gappy = [exp("a", "2026-01-10", 3000), exp("c", "2026-03-10", 3000), exp("d", "2026-04-05", 100)];
    expect(computeBurnRate(gappy, { asOf: "2026-04-15" })).toBe(2000);
  });

  it("drops a one-off spike month (> 3× the window median)", () => {
    // Feb $18k one-off; median of {3000,18000,3000}=3000, 18000>9000 → dropped → (3000+3000)/2 = 3000.
    const spike = [exp("a", "2026-01-10", 3000), exp("b", "2026-02-10", 18000), exp("c", "2026-03-10", 3000), exp("d", "2026-04-05", 100)];
    expect(computeBurnRate(spike, { asOf: "2026-04-15" })).toBe(3000);
    const det = burnRateDetail(spike, { asOf: "2026-04-15" });
    expect(det.window.find((w) => w.ym === "2026-02").dropped).toBe(true);
    expect(det.window.filter((w) => w.dropped).length).toBe(1);
  });

  it("new company with <3 complete months divides by what it has", () => {
    // Only March has a complete month of data (current = April). Divide by 1.
    const young = [exp("c", "2026-03-10", 5000), exp("d", "2026-04-05", 100)];
    expect(computeBurnRate(young, { asOf: "2026-04-15" })).toBe(5000);
    expect(burnRateDetail(young, { asOf: "2026-04-15" }).window.length).toBe(1);
  });

  it("outlier drop only kicks in with ≥3 months to judge against", () => {
    // Two months, one much bigger — with <3 months we do NOT drop (too little to judge).
    const two = [exp("b", "2026-02-10", 2000), exp("c", "2026-03-10", 20000), exp("d", "2026-04-05", 100)];
    expect(computeBurnRate(two, { asOf: "2026-04-15" })).toBe(11000);   // (2000+20000)/2
  });
});
