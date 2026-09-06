import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { duplicateIsExpectedRhythm, deferDuplicateAsk, MIN_OBSERVATIONS } from "../src/lib/recurringVendor.js";

// ── THE LIVE SPECIMEN (Red River, 2026-09-06) ────────────────────────────────
// Three of seven questions asked whether an ordinary weekly delivery was a duplicate:
// Corner Market Aug 8 $65.12 vs Aug 15 $65.34, and the same shape for Hill Country and
// Alamo Ice. Two facts, both true:
//
//  (A) The upload card never consulted history. `findDuplicate` reads vendor, amount and a
//      date window — nothing else — while the anomaly detector (C220) and the invoice
//      matcher (C218) had both learned to suppress a recurring vendor's own cadence. Three
//      implementations of "is this a duplicate"; one never taught.
//
//  (B) And on a cold-start bulk drop the pattern does not exist yet when the second
//      document is read, so (A) alone changes nothing on day one.
//
// ★★★ THE EVIDENCE THAT SETTLES IT: the detector, running over the whole ledger AFTER the
// batch landed, raised ZERO duplicate anomalies for those three vendors. The system had
// the right answer ten minutes later, unattended. The card asked before it knew.

const wk = (id, date, amount, vendor = "Corner Market #221") => ({ id, date, amount, vendor });
// A weekly grocery run: four charges, similar amounts, seven days apart.
const weekly = [
  wk("a", "2026-08-01", 65.00), wk("b", "2026-08-08", 65.12),
  wk("c", "2026-08-15", 65.34), wk("d", "2026-08-22", 64.80),
];

describe("(A) a recurring vendor's own rhythm is not a duplicate", () => {
  it("★ the live pair is recognised as the vendor's normal cadence", () => {
    expect(duplicateIsExpectedRhythm(weekly[2], weekly[1], weekly)).toBe(true);
  });

  it("★★ but an UNUSUAL amount from the same vendor keeps the question", () => {
    // The pattern vouches for the pattern, never for whatever else the vendor sends.
    const odd = wk("x", "2026-08-29", 420.00);
    expect(duplicateIsExpectedRhythm(odd, weekly[3], [...weekly, odd])).toBe(false);
  });

  it("★★ AND A GENUINE DOUBLE-CHARGE STILL SURFACES — same amount, OFF rhythm", () => {
    // The whole risk of suppression is going blind. Two charges one day apart is not
    // this vendor's cadence, and must still be asked about.
    const same = wk("y", "2026-08-16", 65.34);
    expect(duplicateIsExpectedRhythm(same, weekly[2], [...weekly, same])).toBe(false);
  });

  it("★ a vendor with no established pattern keeps the ordinary rule", () => {
    const two = [wk("p", "2026-08-01", 65), wk("q", "2026-08-08", 65)];
    expect(duplicateIsExpectedRhythm(two[1], two[0], two)).toBe(false);
  });
});

describe("(B) during a bulk drop the evidence has not finished arriving", () => {
  it("★ a lone file is NOT a batch — nothing more is coming, so ask now", () => {
    expect(deferDuplicateAsk({ batchSize: 1, sameVendorSoFar: 0 })).toBe(false);
  });

  it("★★ mid-batch, before the pattern can be seen, the ask is deferred", () => {
    expect(deferDuplicateAsk({ batchSize: 35, sameVendorSoFar: 1 })).toBe(true);
  });

  it("★★ once the vendor HAS enough history, the question is asked again", () => {
    // Deferral is about missing evidence, not about silencing the check. Once the
    // evidence exists the ordinary rule decides — which is what keeps a real
    // double-charge from disappearing into the batch.
    expect(deferDuplicateAsk({ batchSize: 35, sameVendorSoFar: MIN_OBSERVATIONS })).toBe(false);
  });
});

describe("the upload path consults both", () => {
  it("★ neither is a pure function nobody calls", () => {
    const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    expect(app).toMatch(/duplicateIsExpectedRhythm\(invoice, rawDup, vendorRows\)/);
    expect(app).toMatch(/deferDuplicateAsk\(\{ batchSize, sameVendorSoFar: vendorRows\.length \}\)/);
    // And the raw finder is no longer wired straight to the card.
    expect(app).not.toMatch(/const dupExisting = dupByNumber \|\| findDuplicate/);
  });
});
