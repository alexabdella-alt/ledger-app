import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { answerToAccount, answerToCategory, clarificationChips } from "../src/lib/clarify";
import { REASONING_CONTRADICTS } from "../src/lib/confidenceFlag";

// ═════════════════════════════════════════════════════════════════════════════
// C553 — A RESTAURANT OWNER'S ANSWERS, AND THE BUTTON THAT SAID ONE THING AND DID ANOTHER.
//
// Reproduced on the code before this commit:
//   "food for the restaurant"   → Travel & Entertainment
//   "linens for the restaurant" → Travel & Entertainment
//   "restaurant supplies"       → Travel & Entertainment
//   the app guessed Food Cost, the card offered "It was food", and the tap sent "a meal"
//   → Travel & Entertainment, over a guess that was right.
// ═════════════════════════════════════════════════════════════════════════════

// A restaurant's chart (the C223 template on the default) and a consultancy's.
const RESTAURANT = {
  food_cost: { code: "5010", name: "Food Cost" }, beverage_cost: { code: "5020", name: "Beverage Cost" },
  paper_packaging: { code: "5030", name: "Paper & Packaging" }, linen_laundry: { code: "6260", name: "Linen & Laundry" },
  waste_removal: { code: "6270", name: "Waste Removal" }, kitchen_supplies: { code: "6280", name: "Kitchen Supplies & Smallwares" },
  cogs: { code: "5000", name: "Cost of Goods Sold" }, travel_entertainment: { code: "6400", name: "Travel & Entertainment" },
  office_supplies: { code: "6600", name: "Office Supplies" }, repairs_maintenance: { code: "6250", name: "Repairs & Maintenance" },
  rent_occupancy: { code: "6100", name: "Rent & Occupancy" }, insurance: { code: "6700", name: "Insurance" },
};
const CONSULTANCY = {
  cogs: { code: "5000", name: "Cost of Goods Sold" }, travel_entertainment: { code: "6400", name: "Travel & Entertainment" },
  office_supplies: { code: "6600", name: "Office Supplies" }, rent_occupancy: { code: "6100", name: "Rent & Occupancy" },
};
const by = (chart) => (role) => chart[role] || null;
const code = (answer, chart = RESTAURANT) => answerToAccount(answer, { getAccountByRole: by(chart) })?.gl_code ?? null;

describe("C553 — a restaurant's typed answers file where a bookkeeper would put them", () => {
  it("★★★ the live answers: food is food cost, not a meal", () => {
    expect(code("food for the restaurant")).toBe("5010");
    expect(code("food")).toBe("5010");
    expect(code("produce for the kitchen")).toBe("5010");
    expect(code("flour and cheese")).toBe("5010");
  });
  it("★★★ 'restaurant' is the owner's premises, not a meal out", () => {
    expect(code("linens for the restaurant")).toBe("6260");
    expect(code("restaurant supplies")).toBe("6280");
    expect(code("linens for the restaurant")).not.toBe("6400");
  });
  it("★★ drinks are beverage cost — the Alamo Ice case", () => {
    expect(code("ice and soda syrup for the bar")).toBe("5020");
    expect(code("CO2 and ice")).toBe("5020");
    expect(code("beer and wine")).toBe("5020");
  });
  it("★ with no Beverage Cost category, drinks fall back to food cost", () => {
    const { beverage_cost, ...noBev } = RESTAURANT;
    expect(code("drinks for the bar", noBev)).toBe("5010");
  });
  it("other template categories the owner names", () => {
    expect(code("dumpster pickup")).toBe("6270");
    expect(code("to-go boxes and napkins")).toBe("5030");
    expect(code("sheet pans and gloves")).toBe("6280");
  });
  it("inventory for resale is cost of sales", () => {
    expect(code("inventory for resale")).toBe("5010");
  });
});

describe("C553 — and what must NOT change", () => {
  it("★★★ a meal out is still a meal, even for a restaurant", () => {
    expect(code("lunch with a client")).toBe("6400");
    expect(code("took a customer to dinner")).toBe("6400");
    expect(code("team dinner after the inventory count")).toBe("6400");
  });
  it("★★ a repair to the ice machine is not drinks inventory", () => {
    expect(code("ice machine repair")).not.toBe("5020");
    expect(code("fixing the walk-in cooler")).not.toBe("5010");
  });
  it("★★★ a business that does NOT sell food: 'food' still means a meal, exactly as before", () => {
    expect(code("food", CONSULTANCY)).toBe("6400");
    expect(code("client dinner", CONSULTANCY)).toBe("6400");
    expect(code("linens", CONSULTANCY)).toBeNull();          // no linen category → nothing invented
  });
  it("resale on a non-food business is cost of goods sold", () => {
    expect(code("inventory for resale", CONSULTANCY)).toBe("5000");
  });
  it("the shared vocabulary no longer calls 'restaurant' a meal", () => {
    expect(answerToCategory("restaurant")).toBeNull();
    expect(answerToCategory("client dinner")).toBe("travel_entertainment");
  });
  it("ordinary answers are untouched", () => {
    expect(code("rent for the space")).toBe("6100");
    expect(code("our business insurance")).toBe("6700");
  });
});

describe("C553 — the one-tap answer books exactly what its label says", () => {
  const foodGuess = { gl_code: "5010", gl_name: "Food Cost", confidence: 80, vendor: "Rio Grande Produce Co.", amount: 247.3, type: "expense" };

  it("★★★ the live case: on a Food Cost guess the chip says food AND carries Food Cost", () => {
    const [chip] = clarificationChips(foodGuess);
    expect(chip.label).toBe("It was food");
    expect(chip.gl_code).toBe("5010");
    expect(chip.answer).not.toBe("a meal");                 // what it used to send
  });
  it("★★ and even its WORDS now land on Food Cost for a restaurant", () => {
    const [chip] = clarificationChips(foodGuess);
    expect(code(chip.answer)).toBe("5010");
  });
  it("a guess on a default-chart account carries that account", () => {
    const [chip] = clarificationChips({ gl_code: "6100", gl_name: "Rent & Occupancy", confidence: 80, vendor: "Franklin Ave Properties", amount: 4512.75, type: "expense" });
    expect(chip.gl_code).toBe("6100");
    expect(chip.label).toBe("It was rent");
  });
  it("C551 still holds: a card asked because the guess contradicts itself offers no chip", () => {
    expect(clarificationChips({ ...foodGuess, ask_reason: REASONING_CONTRADICTS })).toEqual([]);
  });
  it("★★ the card books the chip's account when it is on the chart, and only falls back to words otherwise", () => {
    const flow = fs.readFileSync(path.join(process.cwd(), "src/components/ClarificationFlow.jsx"), "utf8");
    expect(flow).toMatch(/onClick=\{\(\) => tapChip\(chip\)\}/);
    expect(flow).toMatch(/const acct = chip && chip\.gl_code \? \(CHART_OF_ACCOUNTS \|\| \[\]\)\.find\(a => String\(a\.code\) === String\(chip\.gl_code\)\) : null;/);
    expect(flow).toMatch(/submitAnswer\(chip\.answer\);\n  \};/);
  });
});
