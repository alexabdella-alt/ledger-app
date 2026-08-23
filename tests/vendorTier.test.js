import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  VENDOR_TIER, DEMOTION_REASON, GRADUATION_OBSERVATIONS, DORMANCY_MONTHS,
  amountBand, isWithinBand, bandMultiple, monthsBetween,
  graduationStatus, applyMappingCorrection, applyDormancy, resolveTier,
  recordObservation, vendorStateRow,
} from "../src/lib/vendorTier.js";

// ═════════════════════════════════════════════════════════════════════════════
// C201 — the vendor state machine, against O88 spec Q1–Q3.
//
// The two live specimens this exists to fix, from §11 O87 (iv):
//   • BLUEBONNET LINEN (Specimen 1) — excepted SEVEN straight months at ~78 with the
//     correct learned mapping already pre-selected. Under Q1 it is KNOWN at month-2
//     close and auto-books month 3: five wasted attestations eliminated.
//   • LONE STAR RESTAURANT SUPPLY (Specimen 2) — four months, four different verdicts,
//     because confidence recomputed from descriptor noise every time. Under Q3 a tier
//     is a stored fact, so four months produce four identical verdicts.
// Both are tested by name below. If either regresses, the calibration has not
// delivered the thing it was built for.
// ═════════════════════════════════════════════════════════════════════════════

const obs = (month, account_id, amount, attested = true) => ({ month, account_id, amount, attested });

describe("(Q1) graduation — two attested observations, two DISTINCT months, agreeing", () => {
  it("★ SPECIMEN 1 — Bluebonnet is KNOWN at month-2 close", () => {
    const g = graduationStatus([obs("2026-01", "acct-linen", 145), obs("2026-02", "acct-linen", 150)]);
    expect(g.graduates).toBe(true);
    expect(g.attestedAccountId).toBe("acct-linen");
    expect(g.blockers).toEqual([]);
  });

  it("★ SAME-MONTH REPETITION NEVER ACCELERATES THE CLOCK", () => {
    // A weekly vendor billing four times in January has four attested observations and
    // ONE month. Q1: "no exceptions". Amount data improves; the clock does not move.
    const g = graduationStatus([obs("2026-01", "a", 100), obs("2026-01", "a", 102), obs("2026-01", "a", 98), obs("2026-01", "a", 101)]);
    expect(g.attestedCount).toBe(4);
    expect(g.distinctMonths).toBe(1);
    expect(g.graduates).toBe(false);
    expect(g.blockers.join(" ")).toMatch(/fall in 1 statement-month/);
  });

  it("★ UNATTESTED observations never graduate anything", () => {
    // The machine agreeing with itself is the ·3a failure in a different costume.
    const g = graduationStatus([obs("2026-01", "a", 100, false), obs("2026-02", "a", 100, false)]);
    expect(g.graduates).toBe(false);
    expect(g.attestedCount).toBe(0);
  });

  it("a DISAGREEING mapping blocks graduation however many months", () => {
    const g = graduationStatus([obs("2026-01", "a", 100), obs("2026-02", "b", 100), obs("2026-03", "a", 100)]);
    expect(g.graduates).toBe(false);
    expect(g.agreeingMapping).toBe(false);
    expect(g.blockers.join(" ")).toMatch(/attested to 2 different accounts/);
    expect(g.attestedAccountId).toBe(null);   // no single answer ⇒ no answer
  });

  it("one observation is never enough, whatever the amount", () => {
    expect(graduationStatus([obs("2026-01", "a", 999999)]).graduates).toBe(false);
    expect(GRADUATION_OBSERVATIONS).toBe(2);
  });

  it("empty and malformed inputs do not graduate and do not throw", () => {
    for (const input of [[], null, undefined, [{}], [{ month: "nope", account_id: "a", attested: true }]]) {
      expect(graduationStatus(input).graduates, JSON.stringify(input)).toBe(false);
    }
  });
});

describe("(Q3) stability — a tier is a stored fact, not a monthly recomputation", () => {
  it("★ SPECIMEN 2 — Lone Star: four months, four IDENTICAL verdicts", () => {
    // Descriptor noise is what made confidence flap. The state machine never reads a
    // descriptor, so re-resolving across four months cannot move the tier.
    let state = { entity_key: "lone star restaurant supply", tier: VENDOR_TIER.KNOWN, attested_account_id: "acct-cogs", last_seen: "2026-04", observations: [] };
    const verdicts = ["2026-04", "2026-05", "2026-06", "2026-07"].map(() => resolveTier({ state }));
    expect(verdicts).toEqual([VENDOR_TIER.KNOWN, VENDOR_TIER.KNOWN, VENDOR_TIER.KNOWN, VENDOR_TIER.KNOWN]);
    expect(new Set(verdicts).size).toBe(1);
  });

  it("★ AMOUNT BEHAVIOUR NEVER DEMOTES — there is no function that can", () => {
    // Q3, stated as an absence: out-of-band books and flags; one attestation cures.
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/vendorTier.js"), "utf8");
    expect(Object.values(DEMOTION_REASON)).toEqual(["mapping_correction", "dormancy"]);
    // No exported function takes an amount and returns a lowered tier.
    expect(src).not.toMatch(/function\s+\w*[Dd]emote\w*\([^)]*amount/);
  });

  it("a mapping correction demotes IMMEDIATELY and restarts the clock", () => {
    const known = { tier: VENDOR_TIER.KNOWN, attested_account_id: "acct-travel", observations: [obs("2026-01", "acct-travel", 100), obs("2026-02", "acct-travel", 100)] };
    const after = applyMappingCorrection(known, { correctedAccountId: "acct-cogs", at: "2026-03" });
    expect(after.tier).toBe(VENDOR_TIER.DECLARED);
    expect(after.attested_account_id).toBe("acct-cogs");
    expect(after.demotion_reason).toBe(DEMOTION_REASON.MAPPING_CORRECTION);
    // Prior observations attested a mapping that turned out wrong — not evidence for the new one.
    expect(after.observations).toEqual([]);
  });

  it("dormancy decays KNOWN → DECLARED at 6 months, and KEEPS the observations", () => {
    const known = { tier: VENDOR_TIER.KNOWN, last_seen: "2026-01", observations: [obs("2025-12", "a", 100), obs("2026-01", "a", 100)] };
    expect(applyDormancy(known, "2026-06").tier).toBe(VENDOR_TIER.KNOWN);   // 5 months — not yet
    const decayed = applyDormancy(known, "2026-07");                        // 6 months
    expect(decayed.tier).toBe(VENDOR_TIER.DECLARED);
    expect(decayed.demotion_reason).toBe(DEMOTION_REASON.DORMANCY);
    expect(decayed.observations).toHaveLength(2);   // identity survives; only the pattern is stale
    expect(DORMANCY_MONTHS).toBe(6);
  });

  it("dormancy never touches a tier that is not KNOWN", () => {
    const declared = { tier: VENDOR_TIER.DECLARED, last_seen: "2020-01", observations: [] };
    expect(applyDormancy(declared, "2026-07")).toBe(declared);
  });

  it("monthsBetween is calendar arithmetic — no Date, no timezone", () => {
    expect(monthsBetween("2026-01", "2026-07")).toBe(6);
    expect(monthsBetween("2025-11", "2026-02")).toBe(3);
    expect(monthsBetween("bad", "2026-01")).toBe(null);
  });
});

describe("(Q2) the amount band is derived from observed variance, not a flat ±%", () => {
  it("★ a swingy vendor earns a WIDE band; a fixed-fee vendor earns a TIGHT one", () => {
    const produce = amountBand([400, 900, 550, 1200, 700]);      // seasonal swing
    const linen = amountBand([145, 145, 146, 145, 144]);         // fixed fee
    const width = (b) => (b.high - b.low) / b.mean;
    expect(width(produce)).toBeGreaterThan(width(linen));
  });

  it("an identical-amount vendor still gets a usable band, not a zero-width one", () => {
    const b = amountBand([100, 100, 100]);
    expect(b.high).toBeGreaterThan(b.mean);
    expect(isWithinBand(101, b)).toBe(true);   // a one-cent flag would be noise
  });

  it("bandMultiple reports against the MEAN — the number a human can check", () => {
    expect(bandMultiple(240, amountBand([100, 100, 100]))).toBe(2.4);   // "2.4x this vendor's pattern"
  });

  it("no observations ⇒ no band ⇒ no opinion", () => {
    expect(amountBand([])).toBe(null);
    expect(isWithinBand(100, null)).toBe(null);   // not false — we have nothing to say
  });

  it("★ the band never gates — it is a notification boundary (Rule 1)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/vendorTier.js"), "utf8");
    // No function here returns a book/don't-book decision from an amount.
    expect(src).not.toMatch(/shouldBook|canBook|blockBooking|autoBook/);
  });
});

describe("the ladder — attestation outranks census outranks directory", () => {
  it("resolves in the spec's order", () => {
    expect(resolveTier({ state: { tier: VENDOR_TIER.KNOWN }, inCensus: true, inDirectory: true })).toBe(VENDOR_TIER.KNOWN);
    expect(resolveTier({ state: { tier: VENDOR_TIER.DECLARED }, inDirectory: true })).toBe(VENDOR_TIER.DECLARED);
    expect(resolveTier({ inCensus: true, inDirectory: true })).toBe(VENDOR_TIER.DECLARED);
    expect(resolveTier({ inDirectory: true })).toBe(VENDOR_TIER.UNIVERSAL);
    expect(resolveTier({})).toBe(VENDOR_TIER.STRANGER);
  });

  it("★ nothing known ⇒ STRANGER — never a nearest guess", () => {
    expect(resolveTier({ state: null, inCensus: false, inDirectory: false })).toBe(VENDOR_TIER.STRANGER);
  });
});

describe("recordObservation — the full Bluebonnet arc, month by month", () => {
  it("★ STRANGER → (month 1) → (month 2) KNOWN, and month 3 needs no human", () => {
    let s = {};
    s = recordObservation(s, { entity_key: "bluebonnet linen", ...obs("2026-01", "acct-linen", 145) });
    expect(s.tier).toBe(VENDOR_TIER.STRANGER);          // one month is not a norm
    s = recordObservation(s, obs("2026-02", "acct-linen", 150));
    expect(s.tier).toBe(VENDOR_TIER.KNOWN);             // month-2 close
    expect(s.attested_account_id).toBe("acct-linen");
    // Month 3 arrives: already KNOWN, mapping attested, band established.
    expect(resolveTier({ state: s })).toBe(VENDOR_TIER.KNOWN);
    expect(isWithinBand(148, s.band)).toBe(true);
  });

  it("tracks first_seen / last_seen without a clock of its own", () => {
    let s = recordObservation({}, obs("2026-02", "a", 100));
    s = recordObservation(s, obs("2026-01", "a", 100));   // out of order
    expect(s.first_seen).toBe("2026-02");
    expect(s.last_seen).toBe("2026-02");                  // last_seen only moves forward
  });

  it("the persisted row shape carries what the ladder reads back", () => {
    let s = recordObservation({ entity_key: "sysco foods" }, obs("2026-01", "acct-cogs", 1200));
    s = recordObservation(s, obs("2026-02", "acct-cogs", 1300));
    const row = vendorStateRow(s, { companyId: "co1" });
    expect(row).toMatchObject({
      company_id: "co1", entity_key: "sysco foods", tier: VENDOR_TIER.KNOWN,
      attested_account_id: "acct-cogs", observation_count: 2,
    });
    expect(row.distinct_months).toEqual(["2026-01", "2026-02"]);
    expect(row.amount_mean).toBe(1250);
  });
});

describe("the state machine cannot book, and cannot name an account it was not told", () => {
  it("has no imports and no writes", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/vendorTier.js"), "utf8");
    expect(src.match(/^import .*/gm)).toBe(null);
    expect(src).not.toMatch(/supabase|fetch\(|logAudit/);
  });

  it("★ attested_account_id only ever comes from an ATTESTED observation", () => {
    // The ladder may propose only what a human attested. If this ever derives an account
    // from anything else — a guess, a directory default, a similar vendor — the spec's
    // Rule 2 has been broken inside the state machine.
    const s = recordObservation(recordObservation({}, obs("2026-01", "acct-x", 10, false)), obs("2026-02", "acct-x", 10, false));
    expect(s.tier).toBe(VENDOR_TIER.STRANGER);
    expect(s.attested_account_id).toBeUndefined();
  });
});
