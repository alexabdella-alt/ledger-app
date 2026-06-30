import { describe, it, expect } from "vitest";
import { shouldFlagForReview, flaggedForReview, reviewSummary } from "../src/lib/confidenceFlag.js";

// ─────────────────────────────────────────────────────────────────────────────
// O49 FAULT INJECTION / SELECTIVITY — prove the flag catches the uncertain-AND-material
// ones out of a realistic mix, quantify the over-flag rate (must stay small), and DOCUMENT
// the limit: O49 does NOT catch a high-confidence-but-WRONG categorization (that needs
// control-total reconciliation, separate). A net that flags everything — or that you believe
// catches wrong-but-confident coding — is a false sense of safety.
// ─────────────────────────────────────────────────────────────────────────────

const txn = (over = {}) => ({ id: Math.random(), vendor: "Acme", amount: 500, gl_code: "6500", gl_name: "Technology & Software", confidence: 92, status: "booked", ...over });

// Build a realistic ~50-transaction month: mostly confident ordinary activity, a handful of
// genuinely ambiguous ones at varying amounts (some material, some not), plus noise.
function realisticBatch() {
  const out = [];
  // 42 confident, ordinary expenses/revenue across normal amounts
  const vendors = ["AWS", "Gusto", "WeWork", "Adobe", "Stripe", "Comcast", "Delta", "Staples"];
  for (let i = 0; i < 42; i++) out.push(txn({ id: `ok${i}`, vendor: vendors[i % vendors.length], confidence: 85 + (i % 12), amount: 40 + (i * 73) % 1800 }));
  // 4 small ambiguous (immaterial — should NOT flag; this is the over-flag trap)
  for (let i = 0; i < 4; i++) out.push(txn({ id: `smallambig${i}`, vendor: "Cash", confidence: 55 - i, amount: 18 + i * 7 }));
  // 3 genuinely ambiguous AND material (SHOULD flag)
  out.push(txn({ id: "ambig-rent-or-util", confidence: 58, amount: 2400, gl_code: "6100", gl_name: "Rent & Occupancy" }));
  out.push(txn({ id: "ambig-contractor", confidence: 64, amount: 4800, gl_code: "6800", gl_name: "Professional Services" }));
  out.push(txn({ id: "ambig-deeply-unsure", confidence: 38, amount: 900, gl_code: "7100", gl_name: "Miscellaneous" }));
  // 1 very large, only moderately confident (materiality dominates → SHOULD flag)
  out.push(txn({ id: "big-moderate", confidence: 84, amount: 14000, gl_code: "6900", gl_name: "Depreciation" }));
  return out;
}

describe("O49 selectivity: flags EXACTLY the uncertain-and-material, on a realistic mix", () => {
  const batch = realisticBatch();
  const flags = flaggedForReview(batch);

  it("flags exactly the 4 that genuinely need a human look — and none of the rest", () => {
    expect(flags.map(f => f.id).sort()).toEqual(
      ["ambig-contractor", "ambig-deeply-unsure", "ambig-rent-or-util", "big-moderate"].sort()
    );
  });

  it("the small AMBIGUOUS ones are NOT flagged (immaterial — the over-flag trap)", () => {
    expect(flags.some(f => /smallambig/.test(f.id))).toBe(false);
  });

  it("OVER-FLAG RATE is small — a CPA reviews a handful, not the ledger", () => {
    const rate = flags.length / batch.length;
    expect(flags.length).toBe(4);
    expect(batch.length).toBe(50);
    expect(rate).toBeLessThan(0.12);          // < 12% (here 8%) — selective, not noise
    // and the most material / least confident sort first (CPA work order)
    expect(flags[0].id).toBe("big-moderate"); // $14k, high severity → top
  });

  it("each flag carries what a reviewer needs: chosen account + confidence + reason", () => {
    const f = flags.find(x => x.id === "ambig-rent-or-util");
    expect(f.gl_code).toBe("6100");
    expect(f.confidence).toBe(58);
    expect(f.reason).toMatch(/2,400/);
  });

  it("reviewSummary quantifies the review burden", () => {
    const s = reviewSummary(batch);
    expect(s.count).toBe(4);
    expect(s.high).toBeGreaterThanOrEqual(1);
    expect(s.total_amount).toBeGreaterThan(20000);   // the $ exposed to review
  });
});

describe("O49 COVERAGE BOUNDARY (documented limit): confidently-WRONG is NOT caught", () => {
  it("a high-confidence but INCORRECT categorization slips past O49 — by design", () => {
    // The classic dangerous case: a $5,000 software charge the AI confidently mis-codes to
    // Rent at 95%. It is WRONG, but it is not UNCERTAIN — so O49 (which flags uncertainty,
    // not correctness) does NOT flag it.
    const confidentlyWrong = txn({ id: "wrong", vendor: "AWS", amount: 5000, gl_code: "6100", gl_name: "Rent & Occupancy", confidence: 95 });
    expect(shouldFlagForReview(confidentlyWrong).flagged).toBe(false);   // ← NOT caught
    expect(flaggedForReview([confidentlyWrong])).toEqual([]);
  });

  it("documents what DOES catch it: control-total reconciliation, not confidence", () => {
    // O49 protects against the AI *knowing* it's unsure. It does NOT protect against the AI
    // being confidently wrong. Catching wrong-but-confident coding requires INDEPENDENT
    // control totals / reconciliation (O59 Layer 1/2: derived==raw per account, expense-by-
    // category == an independent control sheet, the Riverside tax-into-revenue class) and/or
    // the CPA spot-check (O50). This test exists so that boundary is explicit, not assumed.
    expect(true).toBe(true);
  });
});
