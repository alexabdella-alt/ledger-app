import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  SHADOW_VERDICT, SHADOW_OUTCOME, UNCATEGORIZED, MIN_SCORED_LINES, EXCLUSION,
  buildShadowRecord, scoreShadowRecord, detectMergeCandidates, compareRuns,
  shadowReport, shadowReportCopy, exclusionFor,
} from "../src/lib/calibrationShadow.js";

// ═════════════════════════════════════════════════════════════════════════════
// C201 — the scoring harness, tested against the SIGNED criterion
// (docs/CALIBRATION_SPEC_O88_AMENDMENT_A.md, Alex/CPA, 2026-08-17).
//
// This harness decides whether the booking authority of seven verified drives gets
// replaced. If it is wrong in the permissive direction, the switch ships on evidence
// that does not exist — which is the ·3a failure with the stakes multiplied. So the
// tests below are weighted toward "does it refuse when it should", not "does it pass
// when it should".
// ═════════════════════════════════════════════════════════════════════════════

const line = (over = {}) => ({
  line_id: "L1", descriptor: "SYSCO FOODS", entity_key: "sysco foods", tier: "KNOWN",
  proposed_account_id: "acct-cogs", attested_account_id: "acct-cogs",
  bank_sourced: true, month_attested: true, entry_deleted: false,
  attested_account_system_role: "cogs", ...over,
});
const scored = (over = {}) => { const r = buildShadowRecord(line(over)); r.verdict = scoreShadowRecord(r); return r; };
// A clean run big enough to clear MIN_SCORED_LINES, across two attested months.
const cleanLines = (n = MIN_SCORED_LINES) =>
  Array.from({ length: n }, (_, i) => line({ line_id: `L${i}`, entity_key: `vendor ${i}`, descriptor: `VENDOR ${i}`, attested_account_id: `acct-${i}`, proposed_account_id: `acct-${i}` }));

describe("(§3) scoring one record", () => {
  it("AGREE when the proposal matches the attested account", () => {
    expect(scoreShadowRecord(buildShadowRecord(line()))).toBe(SHADOW_VERDICT.AGREE);
  });

  it("PARK when the ladder declines to name an account", () => {
    expect(scoreShadowRecord(buildShadowRecord(line({ tier: "STRANGER", proposed_account_id: UNCATEGORIZED })))).toBe(SHADOW_VERDICT.PARK);
  });

  it("DISAGREE when it names a different real account", () => {
    expect(scoreShadowRecord(buildShadowRecord(line({ proposed_account_id: "acct-travel" })))).toBe(SHADOW_VERDICT.DISAGREE);
  });

  it("★ PHANTOM when a STRANGER names a real account — even the RIGHT one", () => {
    // Right-by-luck is still the failure. A stranger has, by definition, no attested
    // mapping; naming an account is a guess whether or not the guess lands.
    const rightByLuck = buildShadowRecord(line({ tier: "STRANGER", proposed_account_id: "acct-cogs", attested_account_id: "acct-cogs" }));
    expect(scoreShadowRecord(rightByLuck)).toBe(SHADOW_VERDICT.PHANTOM);
    expect(scoreShadowRecord(rightByLuck)).not.toBe(SHADOW_VERDICT.AGREE);
  });

  it("a STRANGER that parks is correct behaviour, not a miss", () => {
    expect(scoreShadowRecord(buildShadowRecord(line({ tier: "STRANGER", proposed_account_id: UNCATEGORIZED })))).toBe(SHADOW_VERDICT.PARK);
  });
});

describe("(§2) exclusions are applied and REPORTED, never silently dropped", () => {
  it("names a reason for each excluded shape", () => {
    expect(exclusionFor(line({ entry_deleted: true }))).toBe(EXCLUSION.DELETED);
    expect(exclusionFor(line({ month_attested: false }))).toBe(EXCLUSION.UNATTESTED);
    expect(exclusionFor(line({ bank_sourced: false }))).toBe(EXCLUSION.NOT_BANK_SOURCED);
    expect(exclusionFor(line({ attested_account_system_role: null }))).toBe(EXCLUSION.RUNTIME_ACCOUNT);
    expect(exclusionFor(line())).toBe(null);
  });

  it("★ the O108 runtime accounts are excluded — the answer key itself is questionable", () => {
    // 3400/6520/6530 carried system_role NULL and real booked lines. Scoring against
    // them would measure the ladder against a mapping nobody deliberately made.
    const r = shadowReport({ lines: [line({ attested_account_system_role: null })], months: ["2026-07", "2026-08"] });
    expect(r.scored).toBe(0);
    expect(r.excluded).toEqual([{ line_id: "L1", reason: EXCLUSION.RUNTIME_ACCOUNT }]);
  });

  it("excluded lines appear in the copy — a shrinking denominator is always stated", () => {
    const r = shadowReport({ lines: [...cleanLines(), line({ line_id: "X", entry_deleted: true })], months: ["2026-07", "2026-08"] });
    expect(shadowReportCopy(r).join(" ")).toMatch(/1 line was not scored \(1 entry_deleted\)/);
  });
});

describe("(§4.1) automatic fails", () => {
  it("★ ONE phantom stops the switch — no threshold", () => {
    const r = shadowReport({ lines: [...cleanLines(), line({ line_id: "P", tier: "STRANGER", proposed_account_id: "acct-x" })], months: ["2026-07", "2026-08"] });
    expect(r.outcome).toBe(SHADOW_OUTCOME.STOP);
    expect(r.reasons.join(" ")).toMatch(/classified STRANGER proposed a real account/);
  });

  it("★ run-to-run drift stops the switch — KNOWN is a state, not a recomputation", () => {
    const runA = [scored()];
    const runB = [scored({ proposed_account_id: "acct-travel" })];
    expect(compareRuns(runA, runB)).toHaveLength(1);
    const r = shadowReport({ lines: cleanLines(), months: ["2026-07", "2026-08"], priorRun: [scored({ line_id: "L0", proposed_account_id: "acct-other" })] });
    expect(r.outcome).toBe(SHADOW_OUTCOME.STOP);
    expect(r.reasons.join(" ")).toMatch(/changed verdict between runs/);
  });

  it("a stable run drifts by nothing", () => {
    expect(compareRuns([scored()], [scored()])).toEqual([]);
  });
});

describe("(§4.1.2) merge candidates — surfaced, not adjudicated", () => {
  it("flags one entity key attested to two different accounts", () => {
    const recs = [scored({ line_id: "A", entity_key: "sysco", attested_account_id: "acct-cogs" }),
                  scored({ line_id: "B", entity_key: "sysco", descriptor: "SYSCO FUEL", attested_account_id: "acct-fuel" })];
    const m = detectMergeCandidates(recs);
    expect(m).toHaveLength(1);
    expect(m[0].attested_accounts.sort()).toEqual(["acct-cogs", "acct-fuel"]);
  });

  it("one vendor consistently attested to one account is not a candidate", () => {
    expect(detectMergeCandidates([scored({ line_id: "A" }), scored({ line_id: "B" })])).toEqual([]);
  });

  it("★ a candidate BLOCKS but does not auto-STOP — the harness cannot tell merge from split", () => {
    // The criterion makes a real merge an automatic fail. This code cannot distinguish
    // a real merge from one vendor legitimately split across two accounts, so it
    // surfaces the candidate for adjudication instead of failing on the signal.
    // Auto-failing would block on false positives; ignoring it would miss the one-way
    // door. The ambiguity is surfaced rather than resolved by fiat.
    const lines = [...cleanLines(),
      line({ line_id: "M1", entity_key: "shared", attested_account_id: "acct-1", proposed_account_id: "acct-1" }),
      line({ line_id: "M2", entity_key: "shared", attested_account_id: "acct-2", proposed_account_id: "acct-2" })];
    const r = shadowReport({ lines, months: ["2026-07", "2026-08"] });
    expect(r.mergeCandidates).toHaveLength(1);
    expect(r.outcome).toBe(SHADOW_OUTCOME.AMBIGUOUS);
    expect(r.outcome).not.toBe(SHADOW_OUTCOME.STOP);
    expect(r.reasons.join(" ")).toMatch(/needs adjudication/);
  });
});

describe("(§4.2) disagreements are itemised individually, never aggregated", () => {
  it("each carries its own line, descriptor and both accounts, unresolved", () => {
    const r = shadowReport({ lines: [...cleanLines(), line({ line_id: "D1", proposed_account_id: "acct-travel" })], months: ["2026-07", "2026-08"] });
    expect(r.disagreements).toHaveLength(1);
    expect(r.disagreements[0]).toMatchObject({ line_id: "D1", proposed_account_id: "acct-travel", attested_account_id: "acct-cogs", resolution: null });
  });

  it("★ an unresolved disagreement prevents PROCEED", () => {
    const r = shadowReport({ lines: [...cleanLines(), line({ line_id: "D1", proposed_account_id: "acct-travel" })], months: ["2026-07", "2026-08"] });
    expect(r.outcome).toBe(SHADOW_OUTCOME.AMBIGUOUS);
  });
});

describe("(§5) PROCEED / STOP / AMBIGUOUS", () => {
  it("a clean run over two attested months PROCEEDS", () => {
    const r = shadowReport({ lines: cleanLines(), months: ["2026-07", "2026-08"] });
    expect(r.outcome).toBe(SHADOW_OUTCOME.PROCEED);
    expect(r.reasons).toEqual([]);
  });

  it("★ PARK NEVER GATES — an all-parked run still PROCEEDS", () => {
    // The load-bearing clause. Gating on park rate would create pressure to guess,
    // which is plausibility scoring returning through the back door.
    const parked = cleanLines().map((l) => ({ ...l, tier: "STRANGER", proposed_account_id: UNCATEGORIZED }));
    const r = shadowReport({ lines: parked, months: ["2026-07", "2026-08"] });
    expect(r.counts.park).toBe(MIN_SCORED_LINES);
    expect(r.counts.agree).toBe(0);
    expect(r.outcome).toBe(SHADOW_OUTCOME.PROCEED);
  });

  it("★ a thin month is AMBIGUOUS, not a pass", () => {
    const r = shadowReport({ lines: cleanLines(5), months: ["2026-07", "2026-08"] });
    expect(r.outcome).toBe(SHADOW_OUTCOME.AMBIGUOUS);
    expect(r.reasons.join(" ")).toMatch(/only 5 lines were scored/);
  });

  it("one month is not two — coverage is a gate", () => {
    const r = shadowReport({ lines: cleanLines(), months: ["2026-07"] });
    expect(r.outcome).toBe(SHADOW_OUTCOME.AMBIGUOUS);
    expect(r.reasons.join(" ")).toMatch(/at least two/);
  });

  it("STOP outranks AMBIGUOUS — a phantom in a thin month is still a stop", () => {
    const r = shadowReport({ lines: [line({ tier: "STRANGER", proposed_account_id: "acct-x" })], months: ["2026-07"] });
    expect(r.outcome).toBe(SHADOW_OUTCOME.STOP);
  });

  it("every non-PROCEED outcome explains itself", () => {
    for (const r of [shadowReport({ lines: cleanLines(3), months: ["2026-07", "2026-08"] }),
                     shadowReport({ lines: cleanLines(), months: ["2026-07"] }),
                     shadowReport({ lines: [line({ tier: "STRANGER", proposed_account_id: "x" })], months: [] })]) {
      expect(r.outcome).not.toBe(SHADOW_OUTCOME.PROCEED);
      expect(r.reasons.length).toBeGreaterThan(0);
    }
  });
});

describe("(§6 / §1a) copy is query-claims, and never a rate", () => {
  const r = shadowReport({ lines: [...cleanLines(), line({ line_id: "D", proposed_account_id: "acct-travel" })], months: ["2026-07", "2026-08"] });
  const copy = shadowReportCopy(r).join(" ");

  it("always prints numerator AND denominator", () => {
    expect(copy).toMatch(/proposed the attested account on \d+ of \d+ scored lines/);
  });

  it("★ never emits a percentage, a rate, or an adjective about the ladder", () => {
    expect(copy).not.toMatch(/%|percent|accura|reliab|works|safe|good|excellent/i);
  });

  it("parking is described as an absence of a mapping, not as a failure", () => {
    expect(copy).toMatch(/parked in Uncategorized — no attested mapping existed/);
    expect(copy).not.toMatch(/failed|missed|wrong/i);
  });

  it("the zero case is a query-claim about what was measured", () => {
    const clean = shadowReportCopy(shadowReport({ lines: cleanLines(), months: ["2026-07", "2026-08"] })).join(" ");
    expect(clean).toMatch(/No line classified STRANGER proposed a real account\./);
    expect(clean).not.toMatch(/there are no|the ladder is|proven/i);
  });
});

describe("the harness cannot book, by construction", () => {
  it("the module imports nothing that can write", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/calibrationShadow.js"), "utf8");
    expect(src).not.toMatch(/from "\.\/supabase|supabase|persistJournalEntry|logAudit|fetch\(/);
    expect(src.match(/^import .*/gm)).toBe(null);   // no imports at all
  });
});
