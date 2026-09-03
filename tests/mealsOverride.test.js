import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { mealsOverrideAllowed } from "../src/lib/clarify";

// ── THE LIVE SPECIMENS ───────────────────────────────────────────────────────
// A meals wordlist containing "bar", "restaurant", "grill", "catering", "cafe" and
// "coffee" was tested against description + vendor + notes and then OVERWROTE the account
// unconditionally. On a restaurant — the business this product is aimed at — that dragged
// a LINEN service and a KITCHEN SUPPLIER to Travel & Entertainment and stamped both 50%
// deductible. It is not a display bug: it moves the money and halves the deduction.

const linen = {
  vendor: "Bluebonnet Linen Service", type: "expense",
  description: "Bar mops 100 ct, Aprons 40 ct, Kitchen mats — rotation",
  gl_code: "6260", gl_name: "Linen & Laundry",
};
const supply = {
  vendor: "Lone Star Restaurant Supply", type: "expense",
  description: "Sheet pans half size, Deli containers, Nitrile gloves",
  gl_code: "6280", gl_name: "Kitchen Supplies & Smallwares",
};

describe("a meals keyword may refine an account, never replace one", () => {
  it("★ REFUSES to move a linen bill whose line item says 'Bar mops'", () => {
    expect(mealsOverrideAllowed(linen)).toBe(false);
  });

  it("★ REFUSES to move a supplier whose NAME contains 'Restaurant'", () => {
    expect(mealsOverrideAllowed(supply)).toBe(false);
  });

  it("★ NEVER overrules a vendor rule — a mapping a human taught us", () => {
    // Even where the account itself would allow it. Teaching the system a vendor has to
    // be worth more than a wordlist, or teaching it is pointless.
    const generic = { ...linen, gl_code: "7100", gl_name: "Miscellaneous Expense" };
    expect(mealsOverrideAllowed(generic)).toBe(true);
    expect(mealsOverrideAllowed(generic, { fromRule: true })).toBe(false);
  });

  it("★ STILL APPLIES where there is genuinely nothing to overrule", () => {
    // The negative case carries the weight: "linen no longer moves" is equally satisfied
    // by switching the 50% rule off entirely, which would silently overstate deductions
    // on every real client meal.
    expect(mealsOverrideAllowed({ vendor: "Salt Lick BBQ", description: "Dinner with client", gl_code: "", gl_name: "" })).toBe(true);
    expect(mealsOverrideAllowed({ vendor: "Salt Lick BBQ", gl_code: "7100", gl_name: "Miscellaneous Expense" })).toBe(true);
    expect(mealsOverrideAllowed({ vendor: "Salt Lick BBQ", gl_code: "6400", gl_name: "Travel & Entertainment" })).toBe(true);
  });

  it("★ an account nobody has classified yet defaults to NOT being overruled", () => {
    // The allow-set is an ALLOW set on purpose. Overriding is the destructive direction,
    // so a role added later must not silently become overridable.
    expect(mealsOverrideAllowed({ gl_code: "6100", gl_name: "Rent & Occupancy" })).toBe(false);
    expect(mealsOverrideAllowed({ gl_code: "5010", gl_name: "Food Cost" })).toBe(false);
  });

  it("★ the override is actually GATED at the call site, not merely defined", () => {
    // A predicate nobody consults is the defect this repo has hit six times.
    const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    expect(app).toMatch(/GAAP_MEALS_RE\.test[\s\S]{0,200}?mealsOverrideAllowed\(invoice, \{ fromRule/);
  });
});
