import { describe, it, expect } from "vitest";
import { planCoaTemplate, coaTemplateCopy, templateFor, BUSINESS_TYPES } from "../src/lib/coaTemplates.js";
import DEFAULTS from "../src/lib/constants.js";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../src/lib/constants.js";

// ═════════════════════════════════════════════════════════════════════════════
// TIER 1 #6 — A CHART OF ACCOUNTS THAT MATCHES THE BUSINESS.
//
// Every company is seeded with the same generic chart, so Franklin Ave Pizza got
// Subscription Revenue and ASC 842 lease accounting and had nowhere to put food cost.
// ★ THAT IS NOT COSMETIC: the categoriser is CONSTRAINED TO THE CHART IT IS GIVEN, so a
// missing account becomes a miscategorised transaction. Both live specimens are on record —
// a Toast merchant fee in `6500 Technology & Software`, and `Alamo Ice & Beverage` in
// `7100 Miscellaneous`, which is TIER 1 #7's own hard-fail test.
// ═════════════════════════════════════════════════════════════════════════════

const seeded = DEFAULT_CHART_OF_ACCOUNTS.map((a) => ({ ...a, active: true }));

describe("★★ the restaurant template gives a restaurant somewhere to put its costs", () => {
  const plan = planCoaTemplate("Restaurant/Food", seeded, []);
  const codes = plan.add.map((a) => a.code);

  it("adds food and beverage cost — the split a restaurant P&L is built on", () => {
    expect(codes).toContain("5010");
    expect(codes).toContain("5020");
    expect(plan.add.find((a) => a.code === "5010").name).toBe("Food Cost");
  });

  it("★ adds the lines the live miscategorisations had nowhere to go", () => {
    // Linen & laundry is the Bluebonnet charge; kitchen supplies is where CO2 tanks and
    // bagged ice belong instead of `7100 Miscellaneous`.
    expect(codes).toContain("6260");   // Linen & Laundry
    expect(codes).toContain("6280");   // Kitchen Supplies & Smallwares
  });

  it("does NOT re-add merchant fees or bank charges — the generic chart already has them", () => {
    // 6520/6530 were blessed into the default chart at O108. Re-adding would collide.
    expect(codes).not.toContain("6520");
    expect(codes).not.toContain("6530");
  });
});

describe("★★ it is additive — a chart is the client's record, not our opinion", () => {
  it("never proposes a DELETE, for any type", () => {
    for (const t of BUSINESS_TYPES) {
      const plan = planCoaTemplate(t, seeded, []);
      expect(plan).not.toHaveProperty("delete");
      expect(plan).not.toHaveProperty("remove");
    }
  });

  it("★★ NEVER hides an account that carries transactions", () => {
    // The one genuinely destructive thing available here. `4200` is on the restaurant
    // template's hide list; a company that has actually booked to it keeps it.
    const clean = planCoaTemplate("Restaurant/Food", seeded, []);
    expect(clean.hide).toContain("4200");

    const used = planCoaTemplate("Restaurant/Food", seeded, ["4200"]);
    expect(used.hide).not.toContain("4200");
    expect(used.skipped.inUse).toContain("4200");   // and it says WHY it declined
  });

  it("★ never re-adds a code the company already has — a rename is theirs to keep", () => {
    const withFood = [...seeded, { code: "5010", name: "Ingredients (renamed by the client)", active: true }];
    const plan = planCoaTemplate("Restaurant/Food", withFood, []);
    expect(plan.add.map((a) => a.code)).not.toContain("5010");
    expect(plan.skipped.present).toContain("5010");
  });

  it("is idempotent — applying twice adds nothing the second time", () => {
    const first = planCoaTemplate("Restaurant/Food", seeded, []);
    const after = [...seeded, ...first.add.map((a) => ({ ...a, active: true }))];
    const second = planCoaTemplate("Restaurant/Food", after, []);
    expect(second.add).toHaveLength(0);
  });
});

describe("★ every template is internally sound", () => {
  it("no template collides with a code the generic chart already uses", () => {
    const generic = new Set(DEFAULT_CHART_OF_ACCOUNTS.map((a) => a.code));
    for (const t of BUSINESS_TYPES) {
      for (const a of templateFor(t).add) {
        expect(generic.has(a.code), `${t} re-uses generic code ${a.code} (${a.name})`).toBe(false);
      }
    }
  });

  it("★ every added account carries a system_role — or O108's detector calls it invented", () => {
    // `system_role is null and origin <> 'external'` means "materialised at runtime". A
    // template account with a null role would be indistinguishable from the thing that
    // detector exists to find.
    for (const t of BUSINESS_TYPES) {
      for (const a of templateFor(t).add) {
        expect(a.system_role, `${t} / ${a.code} has no system_role`).toBeTruthy();
        expect(a.category, `${t} / ${a.code} has no category`).toBeTruthy();
      }
    }
  });

  it("a code means the same kind of thing wherever it appears", () => {
    // 5010 is "cost of what we sell" in both Restaurant and Retail; the NAME differs, the
    // slot does not. A code that meant two different things across templates would make
    // any cross-company report a lie.
    const byCode = new Map();
    for (const t of BUSINESS_TYPES) {
      for (const a of templateFor(t).add) {
        const prev = byCode.get(a.code);
        if (prev) expect(prev.category, `${a.code} is ${prev.category} in one template and ${a.category} in another`).toBe(a.category);
        else byCode.set(a.code, a);
      }
    }
  });

  it('"Other" is deliberately empty — a business we cannot name gets no opinion', () => {
    expect(planCoaTemplate("Other", seeded, []).add).toHaveLength(0);
  });

  it("an unknown type is a no-op, not a crash", () => {
    const plan = planCoaTemplate("Underwater Basket Weaving", seeded, []);
    expect(plan).toMatchObject({ add: [], hide: [], template: null });
  });
});

describe("★ the copy describes the plan, never the intent", () => {
  it("says what was added and that it can be changed", () => {
    const copy = coaTemplateCopy(planCoaTemplate("Restaurant/Food", seeded, []));
    expect(copy).toMatch(/Added 7 accounts a restaurant\/food business usually needs/);
    expect(copy).toMatch(/rename or change any of them/);
  });

  it("says nothing when nothing happened", () => {
    expect(coaTemplateCopy({ template: "Other", add: [], hide: [] })).toBe(null);
    expect(coaTemplateCopy(null)).toBe(null);
  });

  it("★ reports the hides that SUCCEEDED, not the ones planned", () => {
    // The caller passes the plan with `hide` replaced by what actually committed — a hide
    // that failed must not appear in the sentence (§9).
    const plan = planCoaTemplate("Restaurant/Food", seeded, []);
    expect(coaTemplateCopy({ ...plan, hide: [] })).not.toMatch(/tidied away/);
    expect(coaTemplateCopy({ ...plan, hide: ["4200"] })).toMatch(/tidied away 1/);
  });
});
