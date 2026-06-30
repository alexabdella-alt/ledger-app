import { describe, it, expect } from "vitest";
import { shouldFlagForReview, flaggedForReview, reviewSummary, deriveConfidence, FLAG_DEFAULTS } from "../src/lib/confidenceFlag.js";

// A booked, AI-categorized entry (flatten shape).
const txn = (over = {}) => ({ id: Math.random(), vendor: "Acme", amount: 1200, gl_code: "6500", gl_name: "Technology & Software", confidence: 95, status: "booked", ...over });

describe("(a) a clear/obvious categorization is HIGH confidence and is NOT flagged", () => {
  it("a confident, ordinary expense does not flag", () => {
    const r = shouldFlagForReview(txn({ confidence: 96, amount: 1200 }));
    expect(r.flagged).toBe(false);
  });
  it("a rule-applied / 99% entry never flags, even at a large amount", () => {
    expect(shouldFlagForReview(txn({ confidence: 99, amount: 50000 })).flagged).toBe(false);
  });
  it("an unscored mechanical entry (no confidence) is treated as confident → not flagged", () => {
    expect(shouldFlagForReview({ amount: 8000, gl_code: "1000", status: "booked" }).flagged).toBe(false);
  });
});

describe("(b) a genuinely ambiguous one is LOW confidence and IS flagged with a reason", () => {
  it("uncertain + material → flagged, with a human-readable reason naming the confidence + amount", () => {
    const r = shouldFlagForReview(txn({ confidence: 60, amount: 1800 }));
    expect(r.flagged).toBe(true);
    expect(r.reason).toMatch(/60%/);
    expect(r.reason).toMatch(/1,800/);
    expect(["medium", "high"]).toContain(r.severity);
  });
  it("very low confidence on a non-trivial amount → flagged (genuinely unsure)", () => {
    const r = shouldFlagForReview(txn({ confidence: 40, amount: 300 }));
    expect(r.flagged).toBe(true);
    expect(r.reason).toMatch(/genuinely unsure/);
  });
});

describe("(c) materiality interaction — small+ambiguous may not flag; large+ambiguous does", () => {
  it("small + ambiguous does NOT flag (noise reduction)", () => {
    expect(shouldFlagForReview(txn({ confidence: 60, amount: 200 })).flagged).toBe(false);   // < materiality, conf ≥ hardFloor
    expect(shouldFlagForReview(txn({ confidence: 45, amount: 12 })).flagged).toBe(false);     // immaterial < minAmount, even deeply unsure
  });
  it("large + ambiguous DOES flag (high severity)", () => {
    const r = shouldFlagForReview(txn({ confidence: 60, amount: 8000 }));
    expect(r.flagged).toBe(true);
    expect(r.severity).toBe("high");
  });
  it("very large + MODERATE confidence still flags (materiality dominates)", () => {
    const r = shouldFlagForReview(txn({ confidence: 85, amount: 9000 }));   // 85 ≥ reviewThreshold, but amount ≥ highMateriality & conf < 90
    expect(r.flagged).toBe(true);
    expect(r.reason).toMatch(/Large amount/);
  });
  it("thresholds are tunable", () => {
    // tighten materiality so a $300 ambiguous now flags
    expect(shouldFlagForReview(txn({ confidence: 60, amount: 300 }), { materiality: 100 }).flagged).toBe(true);
    expect(FLAG_DEFAULTS.reviewThreshold).toBe(75);
  });
});

describe("(d) the flagged SET is retrievable with reason + chosen account + alternatives", () => {
  it("flaggedForReview returns the chosen account, confidence, reasoning, alternatives, reason — material-first", () => {
    const ledger = [
      txn({ id: "a", confidence: 96, amount: 1200 }),                                   // clean → excluded
      txn({ id: "b", confidence: 60, amount: 1800, gl_code: "6100", gl_name: "Rent & Occupancy", reasoning: "Picked 6100 because the memo said 'office'", alternatives: [{ gl_code: "6200", gl_name: "Utilities" }] }),
      txn({ id: "c", confidence: 55, amount: 9000, gl_code: "6800", gl_name: "Professional Services" }),
      txn({ id: "v", confidence: 10, amount: 5000, status: "voided" }),                  // voided → excluded
    ];
    const flags = flaggedForReview(ledger);
    expect(flags.map(f => f.id)).toEqual(["c", "b"]);                                    // material/severe first; a & v excluded
    const b = flags.find(f => f.id === "b");
    expect(b.gl_code).toBe("6100");                                                      // the AI's chosen account
    expect(b.confidence).toBe(60);
    expect(b.reasoning).toMatch(/6100/);                                                 // ties C107/C109 reasoning
    expect(b.alternatives[0].gl_code).toBe("6200");                                      // "could be 6200"
    expect(typeof b.reason).toBe("string");
  });
  it("reviewSummary gives a count / high / $ exposed", () => {
    const s = reviewSummary([txn({ confidence: 60, amount: 1800 }), txn({ confidence: 55, amount: 9000 })]);
    expect(s.count).toBe(2);
    expect(s.high).toBe(1);
    expect(s.total_amount).toBe(10800);
  });
});

describe("(e) it does NOT over-flag — a normal clean batch produces few/no flags (THE key property)", () => {
  it("a 20-transaction realistic batch flags only the genuinely-uncertain-and-material ones", () => {
    const batch = [];
    // 17 ordinary, confidently-categorized expenses/revenue (typical day-to-day)
    for (let i = 0; i < 17; i++) batch.push(txn({ id: `ok${i}`, confidence: 88 + (i % 10), amount: 80 + i * 60 }));
    // 1 small ambiguous (should NOT flag — immaterial), 1 ambiguous+material (flag), 1 huge+moderate (flag)
    batch.push(txn({ id: "small", confidence: 55, amount: 40 }));
    batch.push(txn({ id: "ambig-material", confidence: 58, amount: 2200 }));
    batch.push(txn({ id: "huge-moderate", confidence: 84, amount: 12000 }));

    const flags = flaggedForReview(batch);
    expect(flags.map(f => f.id).sort()).toEqual(["ambig-material", "huge-moderate"]);   // exactly the two that matter
    expect(flags.length).toBe(2);                                                       // 2 of 20, not 20 of 20
    expect(flags.length / batch.length).toBeLessThan(0.15);                             // SELECTIVE, not noisy
  });
  it("an all-confident batch flags nothing", () => {
    const batch = Array.from({ length: 10 }, (_, i) => txn({ id: i, confidence: 95, amount: 500 + i * 200 }));
    expect(flaggedForReview(batch)).toEqual([]);
  });
});

describe("deriveConfidence — fallback when the model returns no score", () => {
  it("rule-applied → 99; ambiguous/no-account → lower", () => {
    expect(deriveConfidence({ rule_applied: true })).toBe(99);
    expect(deriveConfidence({ vendor: "Adobe", gl_code: "6500" }, { hasHistory: true })).toBe(80);
    expect(deriveConfidence({ vendor: "x", gl_code: null })).toBeLessThan(60);   // missing account + tiny vendor
  });
});
