import { describe, it, expect } from "vitest";
import { gaapQuestionFitsAccount, couldBeCapital, NEVER_CAPITAL_ROLES } from "../src/lib/clarify";
import { runAnomalyDetection } from "../src/lib/insights";

// ── THE RULE ─────────────────────────────────────────────────────────────────
// The GAAP questions and the large-charge detector both key on WORDS IN THE TEXT. Two
// live specimens from the Red River drive, one root cause:
//   · a dumpster invoice with a "Fuel surcharge" line was asked whether THE VEHICLE is
//     used for business;
//   · the monthly rent was flagged as possibly needing to be capitalized.
// The account fixes the category; text may only refine within it (O115, one layer over).

describe("the vehicle question requires a vehicle", () => {
  it("★ REFUSES a waste-services bill whose text says 'fuel' — the live specimen", () => {
    expect(gaapQuestionFitsAccount("vehicle", {
      gl_code: "6270", gl_name: "Waste Removal",
      description: "Commercial dumpster 4 yd, Fuel surcharge", vendor: "Guadalupe Waste Services",
    })).toBe(false);
  });

  it("★ STILL ASKS when there is no account to go on — text is then all we have", () => {
    // The negative case matters as much: gating on the account must not switch the
    // question off for the uncoded charges it was written for.
    expect(gaapQuestionFitsAccount("vehicle", { gl_code: "", gl_name: "", description: "Shell gas" })).toBe(true);
  });

  it("★ still asks on an account that genuinely cannot settle it", () => {
    expect(gaapQuestionFitsAccount("vehicle", { gl_code: "7100", gl_name: "Miscellaneous Expense" })).toBe(true);
  });
});

describe("capitalization is impossible for accounts that buy nothing you keep", () => {
  it("★ rent, at any size and with no history at all", () => {
    expect(couldBeCapital({ gl_code: "6100", gl_name: "Rent & Occupancy" })).toBe(false);
  });

  it("★ but a real equipment purchase is still asked about", () => {
    expect(couldBeCapital({ gl_code: "7100", gl_name: "Miscellaneous Expense" })).toBe(true);
    expect(couldBeCapital({ gl_code: "", gl_name: "" })).toBe(true);
  });

  it("★ INSURANCE can never be capitalized AND is where the prepaid question belongs", () => {
    // This is why there are two sets rather than one "settled" set. A single set would
    // have silenced the best question in the drive: "how many months does this cover?"
    // on a workers' comp premium.
    expect(NEVER_CAPITAL_ROLES.has("insurance")).toBe(true);
    expect(gaapQuestionFitsAccount("prepaid", { gl_code: "6700", gl_name: "Insurance" })).toBe(true);
  });
});

describe("the detector, end to end", () => {
  const rent = (id, date) => ({
    id, date, vendor: "Franklin Ave Properties LP", amount: 4512.75, type: "expense",
    gl_code: "6100", gl_name: "Rent & Occupancy", status: "booked", source: "universal_upload",
  });
  const gear = (id, date) => ({
    id, date, vendor: "Sabine Kitchen Equipment", amount: 4625, type: "expense",
    gl_code: "7100", gl_name: "Miscellaneous Expense", status: "booked", source: "universal_upload",
  });
  const today = "2026-08-30";

  it("★ a brand-new company's FIRST rent raises nothing", () => {
    const out = runAnomalyDetection([rent("r1", "2026-08-01")], { today });
    expect(out.filter(a => a.type === "large_transaction")).toEqual([]);
  });

  it("★ and the same detector STILL fires on a genuine large purchase", () => {
    // Without this, "rent no longer flags" is equally satisfied by switching the
    // detector off — which is the way a wrong fix looks better than a right one.
    const out = runAnomalyDetection([gear("g1", "2026-08-21")], { today });
    expect(out.filter(a => a.type === "large_transaction").length).toBe(1);
  });
});
