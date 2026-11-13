import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { shouldCapitalize, CAPITALIZE_THRESHOLD } from "../src/lib/constants.js";

// C680 — the IRS de minimis safe harbor: an item costing $2,500 or less is expensed.
describe("capitalize only ABOVE the safe harbor", () => {
  it("$2,500.00 is expensed; $2,500.01 is spread over its life", () => {
    expect(CAPITALIZE_THRESHOLD).toBe(2500);
    expect([shouldCapitalize(2499.99), shouldCapitalize(2500), shouldCapitalize(2500.01)]).toEqual([false, false, true]);
  });
  it("the purchase question uses it", () => {
    expect(readFileSync("src/App.jsx", "utf8")).toMatch(/const capitalize = shouldCapitalize\(amt\);/);
  });
});
