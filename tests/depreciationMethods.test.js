import { describe, it, expect } from "vitest";
import { depreciationAmounts, DEPRECIATION_METHOD } from "../src/lib/depreciation";

// ═════════════════════════════════════════════════════════════════════════════
// METHODS BEYOND STRAIGHT-LINE — §12's deliberate deferral, "known, not silently missing".
//
// ★★★ THE INVARIANT THAT MAKES A METHOD SAFE TO ADD: every schedule sums EXACTLY to
// cost − salvage. An asset must be fully written down to its salvage value and never past
// it, whatever curve it takes. **Over-depreciating writes off value the business still owns;
// under-depreciating leaves a stub nobody notices.**
// ═════════════════════════════════════════════════════════════════════════════

const M = DEPRECIATION_METHOD;
const sum = (a) => Math.round(a.reduce((s, x) => s + x, 0) * 100) / 100;

describe("★★★ every method writes the asset down exactly once", () => {
  const cases = [
    [M.STRAIGHT_LINE, { base: 10000, periods: 5 }],
    [M.STRAIGHT_LINE, { base: 1000, periods: 3 }],            // 333.33 × 3 — rounding must land
    [M.DECLINING_BALANCE, { base: 10000, periods: 5 }],
    [M.DECLINING_BALANCE, { base: 7777.77, periods: 7 }],
    [M.UNITS_OF_PRODUCTION, { base: 10000, periods: 4, unitsPerPeriod: [400, 300, 200, 100] }],
    [M.UNITS_OF_PRODUCTION, { base: 999.99, periods: 3, unitsPerPeriod: [1, 1, 1] }],
  ];
  for (const [method, args] of cases) {
    it(`${method} · base ${args.base} over ${args.periods}`, () => {
      const a = depreciationAmounts({ method, ...args });
      expect(a).toHaveLength(args.periods);
      expect(sum(a)).toBe(Math.round(args.base * 100) / 100);   // exactly, to the cent
      expect(a.every((x) => x >= 0)).toBe(true);                // never negative
    });
  }
});

describe("★★ declining balance", () => {
  it("★★★ SWITCHES to straight-line, or the asset never finishes", () => {
    // Declining balance takes a fraction of what is LEFT each period, so it approaches zero
    // and never arrives — the schedule would end with a stub still on the books. Every
    // textbook makes this switch for exactly that reason.
    const a = depreciationAmounts({ method: M.DECLINING_BALANCE, base: 10000, periods: 5 });
    expect(a).toEqual([4000, 2400, 1440, 1080, 1080]);
    // the tail is flat — that IS the switch, visible in the numbers
    expect(a[3]).toBe(a[4]);
  });

  it("★ front-loads: more in the first period than the last", () => {
    const a = depreciationAmounts({ method: M.DECLINING_BALANCE, base: 10000, periods: 5 });
    const s = depreciationAmounts({ method: M.STRAIGHT_LINE, base: 10000, periods: 5 });
    expect(a[0]).toBeGreaterThan(s[0]);
    expect(a[0]).toBeGreaterThan(a[4]);
  });

  it("a single period writes the whole thing off", () => {
    expect(depreciationAmounts({ method: M.DECLINING_BALANCE, base: 500, periods: 1 })).toEqual([500]);
  });
});

describe("★★ units of production needs the usage, and refuses without it", () => {
  it("★★★ no usage means NO schedule — never a guessed curve", () => {
    // The method exists to measure actual use. Falling back to straight-line would produce a
    // schedule that looks like usage-based depreciation and is not — a wrong answer wearing
    // the right label.
    expect(depreciationAmounts({ method: M.UNITS_OF_PRODUCTION, base: 10000, periods: 4 })).toEqual([]);
    expect(depreciationAmounts({ method: M.UNITS_OF_PRODUCTION, base: 10000, periods: 4, unitsPerPeriod: [0, 0, 0, 0] })).toEqual([]);
  });

  it("★ tracks usage, so an idle period depreciates nothing", () => {
    const a = depreciationAmounts({ method: M.UNITS_OF_PRODUCTION, base: 900, periods: 3, unitsPerPeriod: [10, 0, 20] });
    expect(a[1]).toBe(0);
    expect(sum(a)).toBe(900);
  });
});

describe("★★ an unrecognised method does not silently change the curve", () => {
  it("★★★ it falls back to straight-line, the documented default", () => {
    // A typo'd method name must not produce a different schedule than the one asked for and
    // look plausible doing it.
    // ★★ PINNED TO THE LITERAL CURVE, NOT TO `STRAIGHT_LINE`'s OUTPUT. Comparing the two
    // means both move together under a mutation: making everything decline left them equal
    // and this passed. Two sides of one contract checked against each other is the ·3a shape
    // — it proves they agree, never that either is right.
    const unknown = depreciationAmounts({ method: "macrs_200db", base: 10000, periods: 5 });
    expect(unknown).toEqual([2000, 2000, 2000, 2000, 2000]);
    expect(unknown).toEqual(depreciationAmounts({ method: M.STRAIGHT_LINE, base: 10000, periods: 5 }));
  });

  it("nothing to depreciate produces nothing", () => {
    expect(depreciationAmounts({ base: 0, periods: 5 })).toEqual([]);
    expect(depreciationAmounts({ base: 1000, periods: 0 })).toEqual([]);
  });
});
