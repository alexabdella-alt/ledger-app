import { describe, it, expect } from "vitest";
import { emptyProfile, learnFromBooking, learnFromCorrection, recallVendor } from "../src/lib/clientProfile.js";

// ════════════════════════════════════════════════════════════════════════════
// O67 — human corrections (recode / CPA override) must TEACH the learning layer and
// OUTRANK AI bookings. Before this, a recode wrote only the journal + audit; the stale
// wrong AI mapping survived and re-applied (Franklin's "lone star → 6400 T&E").
// ════════════════════════════════════════════════════════════════════════════

const booking = (vendor, gl_code, gl_name, date = "2026-01-05") => ({ vendor, gl_code, gl_name, amount: 100, date });
const correction = (vendor, gl_code, gl_name, date = "2026-01-20") => ({ vendor, gl_code, gl_name, date });

describe("learnFromCorrection — a recode/override overwrites the vendor mapping", () => {
  it("records the corrected account tagged source:'human_correction'", () => {
    const p = learnFromCorrection(emptyProfile(), correction("Toast Inc", "6520", "Merchant Processing Fees"));
    const v = p.common_vendors["toast inc"];
    expect(v).toMatchObject({ gl_code: "6520", gl_name: "Merchant Processing Fees", source: "human_correction" });
  });

  it("OVERWRITES a stale wrong AI mapping (the exact Lone Star scenario)", () => {
    // Initial AI booking taught the WRONG account…
    let p = learnFromBooking(emptyProfile(), booking("Lone Star Restaurant Supply", "6400", "Travel & Entertainment"));
    expect(p.common_vendors["lone star restaurant supply"]).toMatchObject({ gl_code: "6400", source: "ai_booking" });
    // …the human corrects it → mapping now points to COGS, marked human.
    p = learnFromCorrection(p, correction("Lone Star Restaurant Supply", "5000", "Cost of Goods Sold"));
    expect(p.common_vendors["lone star restaurant supply"]).toMatchObject({ gl_code: "5000", gl_name: "Cost of Goods Sold", source: "human_correction" });
  });

  it("ignores an empty vendor / code", () => {
    const p = emptyProfile();
    expect(learnFromCorrection(p, { vendor: "", gl_code: "5000" })).toBe(p);
    expect(learnFromCorrection(p, { vendor: "X", gl_code: "" })).toBe(p);
  });
});

describe("human-sourced mapping SURVIVES a later AI booking of the same vendor", () => {
  it("a subsequent AI booking cannot silently overwrite the human account", () => {
    let p = learnFromCorrection(emptyProfile(), correction("Lone Star Restaurant Supply", "5000", "Cost of Goods Sold"));
    // The AI re-books Lone Star and (wrongly) wants 6400 again…
    p = learnFromBooking(p, booking("Lone Star Restaurant Supply", "6400", "Travel & Entertainment", "2026-02-05"));
    const v = p.common_vendors["lone star restaurant supply"];
    expect(v.gl_code).toBe("5000");                 // human account preserved
    expect(v.source).toBe("human_correction");      // still human-owned
    expect(v.count).toBe(2);                         // but the re-sighting is recorded
    expect(v.last_seen).toBe("2026-02-05");
  });
});

describe("recallVendor — human trusted immediately; AI needs repetition", () => {
  it("a human correction is recalled on the VERY NEXT invoice (no minCount wait)", () => {
    const p = learnFromCorrection(emptyProfile(), correction("Lone Star Restaurant Supply", "5000", "Cost of Goods Sold"));
    const r = recallVendor(p, "Lone Star Restaurant Supply");   // count is 1
    expect(r).toMatchObject({ gl_code: "5000", gl_name: "Cost of Goods Sold", source: "human_correction" });
  });
  it("an AI mapping seen once is NOT yet recalled (a single early mistake can't harden)", () => {
    const p = learnFromBooking(emptyProfile(), booking("New Vendor", "6500", "Technology & Software"));
    expect(recallVendor(p, "New Vendor")).toBeNull();            // count 1 < minCount 2
  });
  it("an AI mapping seen twice IS recalled", () => {
    let p = learnFromBooking(emptyProfile(), booking("New Vendor", "6500", "Technology & Software"));
    p = learnFromBooking(p, booking("New Vendor", "6500", "Technology & Software"));
    expect(recallVendor(p, "New Vendor")).toMatchObject({ gl_code: "6500", source: "ai_booking", count: 2 });
  });
  it("legacy entries without a source are treated as ai_booking", () => {
    const p = { ...emptyProfile(), common_vendors: { "old co": { name: "Old Co", gl_code: "6100", gl_name: "Rent", count: 3 } } };
    expect(recallVendor(p, "Old Co")).toMatchObject({ gl_code: "6100", source: "ai_booking" });
  });
  it("case/whitespace-insensitive vendor key", () => {
    const p = learnFromCorrection(emptyProfile(), correction("Lone Star Restaurant Supply", "5000", "Cost of Goods Sold"));
    expect(recallVendor(p, "  LONE STAR RESTAURANT SUPPLY  ").gl_code).toBe("5000");
  });
});
