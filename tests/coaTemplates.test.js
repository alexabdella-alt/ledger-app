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

// ═════════════════════════════════════════════════════════════════════════════
// TIER 1 #7's HARD-FAIL TEST — the other half of the same promise.
//
// The roadmap states the joint acceptance test verbatim: *the first document a new signup
// uploads books correctly OR asks a smart question* — never a silent wrong bucket, and
// **"a Miscellaneous fallback on a recognizable vendor is a hard fail."**
//
// ★ THE TWO HALVES ARE ONE PROMISE. The template gives a restaurant somewhere correct to
// put CO2 tanks; this stops the system quietly using the "we couldn't tell" bucket when it
// can name the vendor. Either alone leaves the promise unkept.
// ═════════════════════════════════════════════════════════════════════════════
import { autoBookDecision, isCatchAllAccount, hasNamedVendor } from "../src/lib/confidenceFlag.js";

describe("★★ Miscellaneous on a recognisable vendor is never auto-booked", () => {
  const alamoIce = { vendor: "Alamo Ice & Beverage", amount: 168.4, confidence: 92,
                     gl_code: "7100", gl_name: "Miscellaneous Expense" };

  it("THE LIVE SPECIMEN: Alamo Ice at 92% confidence does NOT auto-book", () => {
    // Nothing here tripped the confidence floor, because the model was confident about the
    // WRONG THING — it was sure it did not know.
    const d = autoBookDecision(alamoIce);
    expect(d.autoBook).toBe(false);
    expect(d.reason).toBe("catch_all_account_named_vendor");
  });

  it("★ the holding account counts too — 7150 means the same thing", () => {
    expect(autoBookDecision({ ...alamoIce, gl_code: "7150", gl_name: "Uncategorized Expense" }).autoBook).toBe(false);
  });

  it("★ and a RENUMBERED chart is caught by the words themselves", () => {
    expect(isCatchAllAccount({ gl_code: "9910", gl_name: "Miscellaneous Expense" })).toBe(true);
    expect(isCatchAllAccount({ gl_code: "9911", gl_name: "Uncategorised Costs" })).toBe(true);
    expect(isCatchAllAccount({ system_role: "uncategorized_expense" })).toBe(true);
  });

  it("★★ it does NOT fire on a small amount — the hard-fail test says nothing about size", () => {
    // Checked before the materiality flag on purpose: a $12 Miscellaneous booking on a
    // named vendor is the same defect as a $1,200 one.
    expect(autoBookDecision({ ...alamoIce, amount: 12 }).reason).toBe("catch_all_account_named_vendor");
  });

  it("★ an UNNAMED line still books — asking about it would be the noise O122 forbids", () => {
    // A bank line with no readable counterparty genuinely has nothing better available.
    for (const vendor of ["", null, "  ", "8842"]) {
      const d = autoBookDecision({ ...alamoIce, vendor });
      expect(d.autoBook, `vendor ${JSON.stringify(vendor)} should still auto-book`).toBe(true);
    }
    expect(hasNamedVendor({ vendor: "Roma Cheese" })).toBe(true);
    expect(hasNamedVendor({ vendor: "884213" })).toBe(false);
  });

  it("a REAL account still books normally — this blocks one bucket, not the feature", () => {
    expect(autoBookDecision({ ...alamoIce, gl_code: "5010", gl_name: "Food Cost" }).autoBook).toBe(true);
    expect(autoBookDecision({ ...alamoIce, gl_code: "6280", gl_name: "Kitchen Supplies & Smallwares" }).autoBook).toBe(true);
  });

  it("★★ it is checked BEFORE the materiality flag, so the REASON is the catch-all one", () => {
    // ★ THIS TEST EXISTS BECAUSE A MUTATION DIDN'T BITE. Moving the check after the
    // materiality flag left every assertion green — my fixture sat at 92% confidence,
    // where none of `shouldFlagForReview`'s conditions fire, so the ordering could not
    // matter for it. The comment in the source claimed the ordering was load-bearing and
    // nothing established that.
    //
    // At 80% on a material amount BOTH rules apply. Either blocks the auto-book, so the
    // outcome is identical — what differs is the REASON, and the reason is what the card
    // says and what a future reader diagnoses from. "We put this in Miscellaneous and can
    // name the vendor" is the more specific and more actionable of the two.
    // 85% on $6,000 trips condition 3 of `shouldFlagForReview` (large amount, less-than-
    // high confidence) while staying above the ask floor — so both rules genuinely apply.
    const d = autoBookDecision({ vendor: "Alamo Ice & Beverage", amount: 6000, confidence: 85,
                                 gl_code: "7100", gl_name: "Miscellaneous Expense" });
    expect(d.autoBook).toBe(false);
    expect(d.reason).toBe("catch_all_account_named_vendor");
    // …and the same transaction on a REAL account falls through to the materiality flag,
    // which proves the two rules genuinely overlap here rather than one being unreachable.
    const real = autoBookDecision({ vendor: "Alamo Ice & Beverage", amount: 6000, confidence: 85,
                                    gl_code: "5010", gl_name: "Food Cost" });
    expect(real.reason).toBe("flagged_uncertain_material");
  });

  it("★ the floor still reports FIRST — the reason must be the most specific true one", () => {
    // A low-confidence Miscellaneous booking is below the floor AND a catch-all. The floor
    // is the more actionable answer, so it wins.
    expect(autoBookDecision({ ...alamoIce, confidence: 40 }).reason).toBe("below_confidence_floor");
  });
});
