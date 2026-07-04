import { describe, it, expect } from "vitest";
import { businessHealth, computeBurnRate } from "../src/lib/reports.js";
import { fmtSignedMoney } from "../src/lib/format.js";

// ════════════════════════════════════════════════════════════════════════════
// Dashboard "Monthly burn" must be the TRAILING-3-MONTH AVERAGE — the same figure
// the runway divides by — NOT the current partial month (which collapsed to the
// single most-recent expense early in a month and disagreed with the runway math
// shown right beside it).
// ════════════════════════════════════════════════════════════════════════════

const exp = (id, date, amt) => ({ id, gl_code: "6000", secondary_gl_code: "1000", amount: amt, debit_credit: "debit", date, type: "expense" });

// Three full months of ~$3,000 spend, then ONE small $100 expense in the current
// (partial) month.
const FIX = [
  exp("a", "2026-01-10", 3000),
  exp("b", "2026-02-10", 3000),
  exp("c", "2026-03-10", 3000),
  exp("d", "2026-04-05", 100),   // the single recent item that used to BECOME the whole "burn"
];
const NOW = new Date(2026, 3, 15);   // Apr 15, local
const burnFact = (bh) => bh.facts.find((f) => f.key === "burn").value;

describe("Monthly burn = trailing-3-mo average, not the latest item", () => {
  const bh = businessHealth(FIX, { cash: 10000, now: NOW });

  it("does NOT collapse to the single most-recent expense", () => {
    expect(burnFact(bh)).not.toBe(fmtSignedMoney(100));
  });

  it("equals the canonical trailing-3-mo burn (the figure runway uses)", () => {
    const trailing = computeBurnRate(FIX, { asOf: "2026-04-15" });   // (3000+3000+100)/3 = 2033.33
    expect(trailing).toBe(2033.33);
    expect(burnFact(bh)).toBe(fmtSignedMoney(trailing));
  });

  it("with a full recent month it reflects the real average, not one transaction", () => {
    const withMany = [...FIX, exp("d2", "2026-04-06", 2900)];   // April now ~$3,000 too
    const bh2 = businessHealth(withMany, { cash: 10000, now: NOW });
    // trailing 3 (Feb+Mar+Apr) = (3000+3000+3000)/3 = 3000
    expect(burnFact(bh2)).toBe(fmtSignedMoney(3000));
  });
});
