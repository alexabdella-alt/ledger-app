import { describe, it, expect } from "vitest";
import {
  normalizeDescriptor, entityKeyFor, resolveVendorIdentity, sameEntity, groupByEntity, MATCH_SOURCE,
} from "../src/lib/vendorIdentity.js";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../src/lib/constants.js";

// ═════════════════════════════════════════════════════════════════════════════
// O88 CALIBRATION — C200. Identity resolution + the honest suspense account.
//
// Identity resolution is now LOAD-BEARING: it does the work descriptor-legibility
// confidence only pretended to do. A KNOWN vendor whose descriptor fails to resolve
// is indistinguishable from a stranger and books to suspense — so a miss here is a
// mis-booking, not a cosmetic issue.
//
// The two failure directions are NOT symmetric and the tests are weighted for it:
//   • FAILING TO MERGE  → a known vendor looks new. Books to Uncategorized, flags,
//     a human fixes it. Recoverable, visible, annoying.
//   • WRONGLY MERGING   → two vendors become one entity, and one vendor's attested
//     mapping silently launders onto the other's charges. That is Q4's "phantom
//     vendor accruing unattested history" one-way door. Unrecoverable, invisible.
// So the anti-merge cases below are the load-bearing ones.
// ═════════════════════════════════════════════════════════════════════════════

describe("normalizeDescriptor — strip the rail, keep the vendor", () => {
  it("strips card-network and ACH prefixes", () => {
    expect(normalizeDescriptor("SQ *BLUEBONNET PRODUCE")).toBe(normalizeDescriptor("Bluebonnet Produce"));
    expect(normalizeDescriptor("TST* LONE STAR")).toBe(normalizeDescriptor("Lone Star"));
    expect(normalizeDescriptor("ACH DEBIT SYSCO FOODS")).toBe(normalizeDescriptor("Sysco Foods"));
    expect(normalizeDescriptor("POS PURCHASE SYSCO FOODS")).toBe(normalizeDescriptor("Sysco Foods"));
    expect(normalizeDescriptor("CHECKCARD 0412 SYSCO FOODS")).toBe(normalizeDescriptor("Sysco Foods"));
  });

  it("strips trailing store numbers, trace numbers, dates and state codes", () => {
    const base = normalizeDescriptor("Sysco Foods");
    for (const d of ["SYSCO FOODS #4417", "SYSCO FOODS 884213", "SYSCO FOODS 04/12", "SYSCO FOODS TX"]) {
      expect(normalizeDescriptor(d), d).toBe(base);
    }
  });

  it("strips STACKED tails — real descriptors carry more than one", () => {
    expect(normalizeDescriptor("SYSCO FOODS #4417 TX")).toBe(normalizeDescriptor("Sysco Foods"));
    expect(normalizeDescriptor("SQ *SYSCO FOODS #4417 04/12")).toBe(normalizeDescriptor("Sysco Foods"));
  });

  it("returns empty for a descriptor carrying no identity at all", () => {
    for (const d of ["", null, undefined, "   ", "884213", "#4417"]) {
      expect(normalizeDescriptor(d), String(d)).toBe("");
    }
    expect(entityKeyFor("884213")).toBe(null);
  });

  it("★ ANTI-MERGE — narrow strips, so two real vendors never collapse into one", () => {
    // The greedy-strip hazard: an over-eager rule that ate trailing words would fold
    // these pairs together, and one vendor's attested mapping would then launder onto
    // the other's charges with nothing on screen to show it happened.
    const pairs = [
      ["Lone Star Restaurant Supply", "Lone Star Linen"],
      ["Sysco Foods", "Sysco Fuel"],
      ["Bluebonnet Produce", "Bluebonnet Bakery"],
      ["ACH DEBIT SYSCO FOODS", "ACH DEBIT SYSCO FUEL"],
    ];
    for (const [a, b] of pairs) {
      expect(normalizeDescriptor(a), `${a} vs ${b}`).not.toBe(normalizeDescriptor(b));
      expect(sameEntity(a, b)).toBe(false);
    }
  });

  it("★ ANTI-MERGE — a bare state-code tail is only stripped when it IS a tail", () => {
    // "TX" at the end is rail noise; a vendor whose NAME ends in two letters is not.
    expect(normalizeDescriptor("SYSCO FOODS TX")).toBe(normalizeDescriptor("Sysco Foods"));
    expect(normalizeDescriptor("Lone Star BBQ")).not.toBe(normalizeDescriptor("Lone Star"));
  });
});

describe("resolveVendorIdentity — who, and how we know", () => {
  const KNOWN = ["lone star restaurant supply"];
  const ALIASES = [{ entityKey: "lone star restaurant supply", descriptor: "LS REST SUPPLY" }];
  const DIRECTORY = [{ entityKey: "stripe", patterns: ["Stripe", "STRIPE PAYMENTS"] }];

  it("an attested ALIAS wins — a human said these are the same", () => {
    const r = resolveVendorIdentity("LS REST SUPPLY", { aliases: ALIASES, knownKeys: KNOWN, directory: DIRECTORY });
    expect(r.entityKey).toBe("lone star restaurant supply");
    expect(r.matchedVia).toBe(MATCH_SOURCE.ALIAS);
  });

  it("an alias recorded from ONE rail catches the same vendor on another", () => {
    // The alias was recorded as "LS REST SUPPLY"; the line arrives card-wrapped.
    const r = resolveVendorIdentity("SQ *LS REST SUPPLY #22", { aliases: ALIASES });
    expect(r.entityKey).toBe("lone star restaurant supply");
    expect(r.matchedVia).toBe(MATCH_SOURCE.ALIAS);
  });

  it("a descriptor landing on a key we hold resolves NORMALIZED", () => {
    const r = resolveVendorIdentity("ACH DEBIT LONE STAR RESTAURANT SUPPLY", { knownKeys: KNOWN });
    expect(r.entityKey).toBe("lone star restaurant supply");
    expect(r.matchedVia).toBe(MATCH_SOURCE.NORMALIZED);
  });

  it("the curated DIRECTORY is binary — exact after normalization, or nothing", () => {
    expect(resolveVendorIdentity("STRIPE PAYMENTS", { directory: DIRECTORY }).matchedVia).toBe(MATCH_SOURCE.DIRECTORY);
    // "Stripey Co" is not 76% Stripe. It is not Stripe.
    expect(resolveVendorIdentity("Stripey Co", { directory: DIRECTORY }).matchedVia).toBe(MATCH_SOURCE.UNRESOLVED);
  });

  it("★ an unknown vendor is UNRESOLVED — an honest miss, never a nearest guess", () => {
    const r = resolveVendorIdentity("ACME WIDGET CO", { aliases: ALIASES, knownKeys: KNOWN, directory: DIRECTORY });
    expect(r.entityKey).toBe(null);
    expect(r.matchedVia).toBe(MATCH_SOURCE.UNRESOLVED);
    expect(r.normalized).toBeTruthy();          // it normalized fine; it just isn't anyone we know
  });

  it("entityKey is null EXACTLY when unresolved — no empty-string entities", () => {
    for (const d of ["", "884213", "  ", null]) {
      const r = resolveVendorIdentity(d, { knownKeys: KNOWN });
      expect(r.matchedVia, String(d)).toBe(MATCH_SOURCE.UNRESOLVED);
      expect(r.entityKey).toBe(null);
    }
  });

  it("never throws on malformed inputs", () => {
    expect(() => resolveVendorIdentity(undefined)).not.toThrow();
    expect(() => resolveVendorIdentity("x", { aliases: [null], knownKeys: [null], directory: [{}] })).not.toThrow();
    expect(resolveVendorIdentity("x", { directory: [{ entityKey: "y" }] }).matchedVia).toBe(MATCH_SOURCE.UNRESOLVED);
  });

  it("returns no account and no score — identity is not a mapping and not a number", () => {
    // The line spec line 27 draws. If this object ever grows a `confidence` or a
    // `gl_code`, plausibility scoring has come back in through the side door.
    const r = resolveVendorIdentity("ACH DEBIT LONE STAR RESTAURANT SUPPLY", { knownKeys: KNOWN });
    expect(Object.keys(r).sort()).toEqual(["entityKey", "matchedVia", "normalized", "rawDescriptor"]);
  });
});

describe("groupByEntity — the shape the census pass reads", () => {
  it("many rails, one vendor, one card to confirm", () => {
    const { groups } = groupByEntity(
      ["SQ *BLUEBONNET PRODUCE", "ACH DEBIT BLUEBONNET PRODUCE", "BLUEBONNET PRODUCE #12", "POS PURCHASE BLUEBONNET PRODUCE"],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].descriptors).toHaveLength(4);
  });

  it("a first-time vendor still gets ONE stable key, so history can accrue under it", () => {
    const { groups } = groupByEntity(["ACME WIDGET CO", "ACH DEBIT ACME WIDGET CO"]);
    expect(groups).toHaveLength(1);
    expect(groups[0].entityKey).toBeTruthy();
  });

  it("identity-less descriptors are returned SEPARATELY, never folded into a bucket", () => {
    const { groups, unresolved } = groupByEntity(["SYSCO FOODS", "884213", ""]);
    expect(groups).toHaveLength(1);
    expect(unresolved).toHaveLength(2);
  });

  it("two vendors stay two groups", () => {
    const { groups } = groupByEntity(["SYSCO FOODS", "SYSCO FUEL"]);
    expect(groups).toHaveLength(2);
  });
});

// ── THE LONE STAR CORPUS (spec line 82) ─────────────────────────────────────
// The spec names "Lone Star's four descriptor variants" as the seed corpus. Those
// four RAW descriptors are recorded NOWHERE in this repo — §11 records the SYMPTOM
// (four months, four verdicts; taught, booked @87 in April, excepted in May with the
// correct account pre-selected) and `tests/clientProfile.test.js` records the
// canonical name and mapping ("Lone Star Restaurant Supply" → 5000 COGS, corrected
// from a wrong 6400 T&E). The descriptors themselves live in the drive statements
// and the live database.
//
// They are NOT invented here. Synthetic rail variants above prove the MECHANICS;
// only the real four prove the CASE the spec cites. The guard below is written to
// fail the moment someone pastes them in, which forces the real assertion to be
// switched on rather than quietly sitting next to a filled-in fixture.
// ★ 2026-08-23 — THE FIXTURES CANNOT SUPPLY THEM. The Franklin Ave extraction shows
// Lone Star's RAW bank text is BYTE-IDENTICAL across all four months
// ("ACH DEBIT - LONE STAR RESTAURANT SUPPLY"). So Specimen 2's flapping cause —
// descriptor variance — IS NOT REPRESENTED IN THE DRIVE DATA AT ALL. The four variants
// were never in the ledger; they were in the statements, or in the reading of them.
//
// This matters more than it looks: the whole fixture program cannot exercise identity
// resolution, because normalisation has no work to do on a constant string. A green
// backfill preview over this data says nothing about the resolver. The corpus needs the
// real statement strings, or explicitly-labelled synthetic variants — and until then
// `planVendorBackfill` reports `variance.identityResolutionUnexercised: true` so a clean
// result can never be read as a tested one.
const REAL_LONE_STAR_DESCRIPTORS = [];   // ← paste the four real descriptors here

describe("(spec line 82) the Lone Star seed corpus", () => {
  it("★ OWED — the four real descriptors are not in this repo and are not invented", () => {
    expect(
      REAL_LONE_STAR_DESCRIPTORS,
      "Corpus landed: delete this guard and enable the it.todo below as a real assertion.",
    ).toHaveLength(0);
  });

  it.todo("all four REAL Lone Star descriptors resolve to ONE entity");
});

// ── THE HONEST SUSPENSE ACCOUNT (spec Rule 2) ───────────────────────────────
describe("(Rule 2) Uncategorized Expense is its own account", () => {
  const byRole = (r) => DEFAULT_CHART_OF_ACCOUNTS.find((a) => a.system_role === r);

  it("7150 exists with system_role uncategorized_expense", () => {
    expect(byRole("uncategorized_expense")).toMatchObject({ code: "7150", category: "Expenses" });
  });

  it("★ it is NOT Miscellaneous — collapsing them would delete Tier 1 #7's test", () => {
    // "Miscellaneous fallback on a recognizable vendor is a HARD FAIL" (Tier 1 #7).
    // Miscellaneous means we looked; Uncategorized means we did not know. If a
    // stranger parked in 7100, that acceptance test could no longer tell the
    // difference between working correctly and failing exactly as predicted.
    const misc = byRole("miscellaneous_expense");
    const unc = byRole("uncategorized_expense");
    expect(misc.code).toBe("7100");
    expect(unc.code).not.toBe(misc.code);
    expect(unc.system_role).not.toBe(misc.system_role);
  });

  it("the code is unique in the chart", () => {
    expect(DEFAULT_CHART_OF_ACCOUNTS.filter((a) => a.code === "7150")).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// O119 — THE SAME SUPPLIER WRITTEN TWO WAYS IS ONE SUPPLIER.
//
// Live specimen, August: Roma arrived as `ACH DEBIT - ROMA CHEESE & DAIRY CO` on 08-04 and
// `ACH DEBIT - ROMA CHEESE + DAIRY CO` on 08-19. `normalizeName` mapped `&` to "and" and
// left `+` alone — and `+` was not in the punctuation strip either — so the two keyed as
// different companies. Nothing broke; the second simply sat unmatched, and the ladder
// would have learned one vendor's habits twice under two names.
//
// ★ THIS WIDENS A MERGE RULE, which is the one-way door: a wrong merge silently launders
// one vendor's attested mapping onto another's charges. So the anti-merge pairs are
// asserted alongside, and they are the reason to trust the widening rather than the
// widening being the reason to trust itself.
// ═════════════════════════════════════════════════════════════════════════════
describe("★★ O119 — a plus sign joins a name exactly as an ampersand does", () => {
  it("THE LIVE PAIR: the two August Roma descriptors reach ONE key", () => {
    const a = entityKeyFor("ACH DEBIT - ROMA CHEESE & DAIRY CO");
    const b = entityKeyFor("ACH DEBIT - ROMA CHEESE + DAIRY CO");
    expect(a).toBe("roma cheese and dairy");
    expect(b).toBe(a);
  });

  it("and the invoice-side spelling joins them too", () => {
    expect(entityKeyFor("Roma Cheese + Dairy Co.")).toBe(entityKeyFor("Roma Cheese & Dairy Co"));
  });

  it("★ it does NOT merge vendors that differ by anything more than the joiner", () => {
    // The widening must be exactly one character wide. These pairs are genuinely
    // different businesses and must stay that way.
    const pairs = [
      ["SYSCO", "SYSCO FUEL"],
      ["ROMA CHEESE + DAIRY", "ROMA CHEESE + DAIRY SUPPLY"],
      ["LONE STAR", "LONE STAR RESTAURANT SUPPLY"],
      ["A+ PLUMBING", "PLUMBING"],
    ];
    for (const [x, y] of pairs) {
      expect(entityKeyFor(x)).not.toBe(entityKeyFor(y));
    }
  });

  it("★ a bare joiner still carries no identity — it must not mint an entity", () => {
    // A descriptor that normalizes to nothing but the joining word is not a vendor.
    expect(entityKeyFor("+")).toBe(null);
    expect(entityKeyFor("& & &")).toBe(null);
  });
});
