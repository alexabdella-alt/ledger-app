// C691 — four sorting fixes from the third review.
import { describe, it, expect } from "vitest";
import { travelSplitFor, lineForAccount, scheduleCBreakdown } from "../src/lib/taxGuidance.js";

describe("C691 — a hotel stay is travel (100%), not a meal (50%)", () => {
  for (const v of ["Westin Austin", "Sheraton", "Holiday Inn Express", "Hampton Inn", "Residence Inn", "Hotels.com", "Four Seasons", "Best Western"])
    it(v, () => expect(travelSplitFor({ vendor: v })).toEqual({ line: "24a", share: 1 }));
  for (const v of ["Taco Inn", "Metro Diner", "Olive Garden"])
    it(`${v} stays a meal`, () => expect(travelSplitFor({ vendor: v })).toEqual({ line: "24b", share: 0.5 }));
});

describe("C691 — a conference or trade show is a business cost (100%), not entertainment", () => {
  it("in a travel & entertainment account", () => {
    expect(travelSplitFor({ vendor: "Austin Trade Show" })).toEqual({ line: "27a", share: 1 });
    expect(travelSplitFor({ vendor: "VidCon", description: "conference registration" })).toEqual({ line: "27a", share: 1 });
    expect(travelSplitFor({ vendor: "Ticketmaster", description: "concert" })).toEqual({ line: "none", share: 0 });
  });
  it("as a category name", () => {
    expect(lineForAccount({ name: "Trade Shows" })).toMatchObject({ line: "27a", share: 1 });
    expect(lineForAccount({ name: "Conference tickets" })).toMatchObject({ line: "27a", share: 1 });
    expect(lineForAccount({ name: "Event tickets" })).toMatchObject({ line: "none", share: 0 });
  });
});

describe("C691 — Gas & Electric is a utility", () => {
  it("not the car", () => {
    expect(lineForAccount({ name: "Gas & Electric" }).line).toBe("25");
    expect(lineForAccount({ name: "Natural gas" }).line).toBe("25");
    expect(lineForAccount({ name: "Gas" }).line).toBe("9");
    expect(lineForAccount({ name: "Fuel" }).line).toBe("9");
  });
});

describe("C691 — a business entity's state income tax is deductible", () => {
  it("C corp state tax, S corp / partnership PTET deduct; a sole proprietor's stays personal; federal never", () => {
    expect(lineForAccount({ name: "State Income Tax", legalForm: "c_corp" })).toMatchObject({ line: "23", share: 1 });
    expect(lineForAccount({ name: "Pass-through entity tax", legalForm: "s_corp" })).toMatchObject({ line: "23", share: 1 });
    expect(lineForAccount({ name: "PTET", legalForm: "partnership" })).toMatchObject({ line: "23", share: 1 });
    expect(lineForAccount({ name: "State Income Tax", legalForm: "sole_prop" })).toMatchObject({ line: "none", share: 0 });
    expect(lineForAccount({ name: "State Income Tax" })).toMatchObject({ line: "none", share: 0 });
    expect(lineForAccount({ name: "Federal Income Tax", legalForm: "c_corp" })).toMatchObject({ line: "none", share: 0 });
    // a combined account can't be split — the federal part is never deductible (§275), so none
    expect(lineForAccount({ name: "Federal & State Income Tax", legalForm: "c_corp" })).toMatchObject({ line: "none", share: 0 });
  });
  it("and the breakdown applies the company's form", () => {
    const chart = [{ code: "7200", name: "State Income Tax" }];
    const led = [{ id: "t", date: "2026-04-15", gl_code: "7200", amount: 1000, debit_credit: "debit", status: "booked" }];
    expect(scheduleCBreakdown(led, 2026, { chart, legalForm: "c_corp" }).deductibleTotal).toBe(1000);
    expect(scheduleCBreakdown(led, 2026, { chart, legalForm: "sole_prop" }).deductibleTotal).toBe(0);
  });
});
