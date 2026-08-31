import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  CARD_CATEGORY, CARD_TAXONOMY, categoryOf, cardRateReport, cardRateCopy,
  RATE_MODE, STEADY_TARGET_RATE,
} from "../src/lib/cardRate";

// ═════════════════════════════════════════════════════════════════════════════
// O122 — "ALL BEHAVIOURS CORRECT" AND "THE PRODUCT IS USABLE" ARE DIFFERENT CLAIMS, AND
// ONLY THE FIRST HAS EVER BEEN TESTED.
//
// Every drive and every suite here scores INDIVIDUAL behaviours, so we can end with every
// behaviour correct and a screen carrying nine cards. Unit tests structurally cannot catch
// that: one asserts a card is RIGHT, never that there are few enough of them.
// ═════════════════════════════════════════════════════════════════════════════

describe("★★★ the split is the deliverable, not the total", () => {
  it("★★ ONE defect fails the run, however small a share of the documents it is", () => {
    // Averaging is how a bug becomes "within tolerance". A category-1 card's expected value
    // is ZERO, so a single occurrence fails regardless of the percentage it works out to.
    //
    // ★ THE NUMBERS BELOW ARE A FIXTURE, NOT A MEASUREMENT — and saying so is the point of
    // this comment. Describing this case as "a 1% failure rate" was read as a claim that
    // one in a hundred records fails to save, which is not true of anything: the only time
    // `record_failed` has ever been observed it fired on THREE OF THREE attempts (the
    // `patch`/`values` parameter bug), and since that fix, never. The scenario is
    // constructed to make the percentage look GOOD so the assertion has something to
    // overrule; a large denominator is how you build that, not a claim about one.
    const r = cardRateReport({ cards: [{ reason: "record_failed" }], documentCount: 100 });
    expect(r.total).toBe(1);
    expect(r.bugs).toBe(1);
    expect(r.rate).toBeLessThan(STEADY_TARGET_RATE);   // the percentage passes…
    expect(r.withinTarget).toBe(false);                // …and the run fails anyway
  });

  it("★ a clean run inside the target passes", () => {
    const cards = [{ reason: "amount_differs" }, { type: "duplicate_payment" }];
    const r = cardRateReport({ cards, documentCount: 60 });
    expect(r).toMatchObject({ bugs: 0, teaching: 0, judgment: 2, withinTarget: true });
  });

  it("★★ the copy leads with the split, because the total is the least informative number", () => {
    const r = cardRateReport({ cards: [{ reason: "identity_differs" }, { type: "vendor_spike" }], documentCount: 40 });
    const copy = cardRateCopy(r);
    expect(copy).toMatch(/1 we got wrong · 1 teaching · 1 judgment|0 we got wrong · 1 teaching · 1 judgment/);
    expect(copy).toContain("2 cards across 40 documents");
  });

  it("★★★ a falling total with a flat category 2 is visible — which is the whole point", () => {
    // "The teaching isn't sticking" is invisible in an aggregate: the total drops while the
    // same onboarding questions keep being asked.
    const m1 = cardRateReport({ cards: [{ reason: "identity_differs" }, { reason: "identity_differs" }, { type: "round_number" }, { type: "vendor_spike" }], documentCount: 60 });
    const m2 = cardRateReport({ cards: [{ reason: "identity_differs" }, { reason: "identity_differs" }], documentCount: 60 });
    expect(m2.total).toBeLessThan(m1.total);     // looks like progress…
    expect(m2.teaching).toBe(m1.teaching);       // …and it is not: the same two, again
  });
});

describe("★★ an unrecognised card is REPORTED, never defaulted", () => {
  it("★★★ it does not silently become a judgment call", () => {
    // Bucketing an unknown kind into "judgment" would flatter the number by exactly the
    // amount we do not understand — and a new card kind nobody classified is the most
    // likely place for a category-1 defect to hide.
    const r = categoryOf({ type: "some_new_card" });
    expect(r.category).toBeNull();
    expect(r.why).toMatch(/classify it before trusting the rate/);
  });

  it("★ and the report says the rate is unreliable while any remain", () => {
    const r = cardRateReport({ cards: [{ type: "mystery" }], documentCount: 10 });
    expect(r.unclassified).toEqual(["mystery"]);
    expect(cardRateCopy(r)).toMatch(/not classified — the rate is unreliable until they are/);
  });
});

describe("★★ onboarding and steady state are not compared", () => {
  it("★ onboarding has no target rather than borrowing steady state's", () => {
    // Conflating them would either make onboarding look broken or make steady state look
    // fine. Saying "no target set" is better than lending it one.
    const r = cardRateReport({ cards: [{ reason: "identity_differs" }], documentCount: 5, mode: RATE_MODE.ONBOARDING });
    expect(r.withinTarget).toBeNull();
    expect(cardRateCopy(r)).toMatch(/no target set for this mode yet/);
  });

  it("no documents means no rate — not a rate of zero", () => {
    expect(cardRateCopy(cardRateReport({ cards: [], documentCount: 0 }))).toMatch(/no rate to report/);
  });
});

describe("★★ the taxonomy covers what the product can actually emit", () => {
  const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

  it("★★★ every anomaly type the detector emits is classified", () => {
    // A kind that exists in the product and not in the taxonomy is an unmeasured card, and
    // the report would flag it as unclassified forever without anyone deciding.
    const emitted = [...read("src/lib/insights.js").matchAll(/type: "([a-z_]+)"/g)].map((m) => m[1]);
    const missing = [...new Set(emitted)].filter((t) => !CARD_TAXONOMY[t]);
    expect(missing).toEqual([]);
  });

  it("★★★ and every lifecycle ASK_REASON is classified", () => {
    const block = read("src/lib/invoicePayment.js");
    const start = block.indexOf("export const ASK_REASON = {");
    const reasons = [...block.slice(start, block.indexOf("};", start)).matchAll(/: "([a-z_]+)"/g)].map((m) => m[1]);
    expect(reasons.length).toBeGreaterThanOrEqual(5);
    expect(reasons.filter((r) => !CARD_TAXONOMY[r])).toEqual([]);
  });

  it("★ every entry carries a REASON, not just a number", () => {
    // "Why is this a judgment call?" has to be answerable from the taxonomy, or the next
    // person re-litigates each one from scratch.
    for (const [kind, entry] of Object.entries(CARD_TAXONOMY)) {
      expect([kind, typeof entry.why]).toEqual([kind, "string"]);
      expect([kind, entry.why.length > 20]).toEqual([kind, true]);
      expect([kind, Object.values(CARD_CATEGORY).includes(entry.category)]).toEqual([kind, true]);
    }
  });

  it("★★ the entries that CHANGED category record that they did", () => {
    // Several were category 1 only while a bug was live — payroll tripping the large-charge
    // detector, staleness measured against wall-clock, duplicates on lifecycle pairs. A
    // taxonomy that silently re-grades itself hides the improvement it exists to show.
    const changed = ["duplicate_payment", "large_transaction", "round_number", "missing_recurring"];
    for (const k of changed) expect([k, CARD_TAXONOMY[k].why]).toEqual([k, expect.stringMatching(/was category 1/)]);
  });
});
