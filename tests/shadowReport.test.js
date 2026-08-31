import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import {
  MIN_ATTESTED_MONTHS, MIN_SCORED_LINES, SHADOW_VERDICT, coverageGaps, mergeCandidates,
  runToRunVariance, shadowReport, shadowReportCopy, strangerViolations,
} from "../src/lib/shadowReport";

// A clean pass: two attested months, enough lines, everything agreeing.
const row = (i, o = {}) => ({
  journal_entry_line_id: `l${i}`, period: i % 2 ? "2026-07" : "2026-08",
  descriptor_display: `Vendor ${i}`, entity_key: `vendor ${i}`, tier: "known",
  proposed_account_id: "a1", attested_account_id: "a1", verdict: "agree", excluded_reason: null, ...o,
});
const makeRun = (n = 24, over = {}) => {
  const rows = Array.from({ length: n }, (_, i) => row(i));
  Object.assign(rows, over.rows || {});
  return {
    rows, scored: rows.filter((r) => r.verdict).length,
    counts: { agree: rows.filter((r) => r.verdict === "agree").length, park: 0, disagree: 0, phantom: 0 },
    parkBasis: {}, ...over.top,
  };
};
const CLEAN = { runs: [makeRun()], attestedMonths: ["2026-07", "2026-08"] };

describe("the shadow report decides whether the ladder may start booking", () => {
  it("★ a clean pass over two attested months including August proceeds", () => {
    const r = shadowReport(CLEAN);
    expect(r.verdict).toBe(SHADOW_VERDICT.PROCEED);
    expect(r.blockers).toEqual([]);
  });

  it("★★★ ONE phantom stops it — no threshold, no discussion", () => {
    const run = makeRun();
    run.rows[3] = row(3, { tier: "stranger", proposed_account_id: "a9" });
    const r = shadowReport({ ...CLEAN, runs: [run] });
    expect(r.verdict).toBe(SHADOW_VERDICT.STOP);
    expect(r.phantoms.length).toBe(1);
  });

  it("★ a stranger that parks is fine — that is Rule 2 working", () => {
    const run = makeRun();
    run.rows[3] = row(3, { tier: "stranger", proposed_account_id: null, verdict: "park" });
    run.counts = { agree: 23, park: 1, disagree: 0, phantom: 0 };
    run.parkBasis = { stranger: 1 };
    expect(shadowReport({ ...CLEAN, runs: [run] }).verdict).toBe(SHADOW_VERDICT.PROCEED);
  });

  it("★★★ SAME VERDICT, DIFFERENT ACCOUNT across runs is ALSO variance — a surviving mutation found this gap", () => {
    // My first variance test only varied the verdict, so dropping proposed_account_id from
    // the comparison key changed nothing and the mutation lived. A line can read "agree" in
    // both runs while proposing a different account each time — same label, different answer,
    // and it is exactly the flapping §4.1(3) forbids.
    const a = makeRun(), b = makeRun();
    b.rows[5] = row(5, { verdict: "agree", proposed_account_id: "a2" });
    const r = shadowReport({ runs: [a, b], attestedMonths: ["2026-07", "2026-08"] });
    expect(r.variance.length).toBe(1);
    expect(r.verdict).toBe(SHADOW_VERDICT.STOP);
  });

  it("★★ a verdict that flips between runs on identical input stops it — KNOWN is a state, not a recomputation", () => {
    const a = makeRun(), b = makeRun();
    b.rows[5] = row(5, { verdict: "disagree", proposed_account_id: "a2" });
    const r = shadowReport({ runs: [a, b], attestedMonths: ["2026-07", "2026-08"], resolvedDisagreements: ["l5"] });
    expect(r.variance.length).toBe(1);
    expect(r.verdict).toBe(SHADOW_VERDICT.STOP);
  });

  it("★★ a line with no verdict and no reason stops it — an unmeasured line is not a passing line", () => {
    const run = makeRun();
    run.rows[7] = row(7, { verdict: null, excluded_reason: null });
    const r = shadowReport({ ...CLEAN, runs: [run] });
    expect(r.coverageGaps.length).toBe(1);
    expect(r.verdict).toBe(SHADOW_VERDICT.STOP);
  });
});

describe("★★★ it will not grant itself a human's sign-off", () => {
  it("an unresolved disagreement stops it, and absent resolution means UNRESOLVED", () => {
    const run = makeRun();
    run.rows[2] = row(2, { verdict: "disagree", proposed_account_id: "a2" });
    run.counts = { agree: 23, park: 0, disagree: 1, phantom: 0 };
    const r = shadowReport({ ...CLEAN, runs: [run] });
    expect(r.unresolvedDisagreements.length).toBe(1);
    expect(r.verdict).toBe(SHADOW_VERDICT.STOP);
    // …and resolving it by hand clears exactly that one.
    const after = shadowReport({ ...CLEAN, runs: [run], resolvedDisagreements: ["l2"] });
    expect(after.verdict).toBe(SHADOW_VERDICT.PROCEED);
  });

  it("★★ a key covering two names is FLAGGED for a person, not adjudicated", () => {
    const run = makeRun();
    run.rows[1] = row(1, { entity_key: "roma cheese", descriptor_display: "ROMA CHEESE & DAIRY" });
    run.rows[2] = row(2, { entity_key: "roma cheese", descriptor_display: "Roma Cheese Bakery" });
    const r = shadowReport({ ...CLEAN, runs: [run] });
    expect(r.mergeCandidates.length).toBe(1);
    expect(r.verdict).toBe(SHADOW_VERDICT.STOP);
    const cleared = shadowReport({ ...CLEAN, runs: [run], clearedMergeCandidates: ["roma cheese"] });
    expect(cleared.verdict).toBe(SHADOW_VERDICT.PROCEED);
  });
});

describe("thin evidence is neither a pass nor a fail", () => {
  it("★ fewer than 20 scored lines is AMBIGUOUS — a thin month cannot read as a pass", () => {
    const r = shadowReport({ runs: [makeRun(8)], attestedMonths: ["2026-07", "2026-08"] });
    expect(r.verdict).toBe(SHADOW_VERDICT.AMBIGUOUS);
    expect(MIN_SCORED_LINES).toBe(20);
  });

  it("★★ but a hard fail in a thin month still STOPS — it must not hide behind 'not enough data'", () => {
    const run = makeRun(8);
    run.rows[1] = row(1, { tier: "stranger", proposed_account_id: "a9" });
    expect(shadowReport({ runs: [run], attestedMonths: ["2026-07", "2026-08"] }).verdict).toBe(SHADOW_VERDICT.STOP);
  });

  it("one month is not enough, and August is required", () => {
    expect(shadowReport({ runs: [makeRun()], attestedMonths: ["2026-08"] }).verdict).toBe(SHADOW_VERDICT.STOP);
    const julyOnly = { rows: makeRun().rows.map((r) => ({ ...r, period: "2026-07" })) };
    julyOnly.scored = julyOnly.rows.length;
    julyOnly.counts = { agree: julyOnly.rows.length, park: 0, disagree: 0, phantom: 0 };
    expect(shadowReport({ runs: [julyOnly], attestedMonths: ["2026-06", "2026-07"] }).verdict).toBe(SHADOW_VERDICT.STOP);
    expect(MIN_ATTESTED_MONTHS).toBe(2);
  });

  it("an unsigned month does not count toward the two", () => {
    // Covering July and August but only July attested is one attested month, not two.
    expect(shadowReport({ runs: [makeRun()], attestedMonths: ["2026-07"] }).verdict).toBe(SHADOW_VERDICT.STOP);
  });
});

describe("the copy is a claim about what was measured (§6)", () => {
  it("★ gives the numerator AND the denominator, never a percentage", () => {
    const run = makeRun();
    run.rows[4] = row(4, { verdict: "park", proposed_account_id: null, tier: "stranger" });
    run.counts = { agree: 23, park: 1, disagree: 0, phantom: 0 };
    run.parkBasis = { stranger: 1 };
    const t = shadowReportCopy(shadowReport({ ...CLEAN, runs: [run] }));
    expect(t).toMatch(/23 of 24 scored lines/);
    expect(t).toMatch(/1 of 24 parked in Uncategorized/);
    expect(t).not.toMatch(/%|accura|confiden/i);
  });

  it("★★ says WHY things parked — a park rate without reasons is a number nobody can act on", () => {
    const run = makeRun();
    run.rows[4] = row(4, { verdict: "park", proposed_account_id: null, tier: "stranger" });
    run.counts = { agree: 23, park: 1, disagree: 0, phantom: 0 };
    run.parkBasis = { stranger: 1 };
    expect(shadowReportCopy(shadowReport({ ...CLEAN, runs: [run] }))).toMatch(/suppliers we had never seen/);
  });

  it("a STOP names what is outstanding rather than just refusing", () => {
    const run = makeRun();
    run.rows[3] = row(3, { tier: "stranger", proposed_account_id: "a9" });
    const t = shadowReportCopy(shadowReport({ ...CLEAN, runs: [run] }));
    expect(t).toMatch(/Not ready\. Outstanding:/);
    expect(t).toMatch(/never seen was given a real account/);
  });

  it("no accounting jargon on a sentence a CPA reads alongside the owner", () => {
    const t = shadowReportCopy(shadowReport(CLEAN)) || "";
    expect(t).not.toMatch(/GL |debit|credit|journal entry|entity_key|tier/i);
  });

  it("no runs, no claim", () => {
    expect(shadowReportCopy(null)).toBe(null);
    expect(shadowReportCopy(shadowReport({}))).toMatch(/nothing to judge yet/);
  });
});

describe("it books nothing and runs nothing", () => {
  it("★★ the module cannot write, cannot query, and cannot reach a booking primitive", () => {
    const src = readFileSync("src/lib/shadowReport.js", "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    for (const forbidden of ["supabase", "runShadowPass", "persistJournalEntry", "post_journal_entry", "ensureAccount", ".insert(", ".update("]) {
      expect(src).not.toContain(forbidden);
    }
  });
});

describe("★★ the trigger exists — a runner nobody invokes is the same as no runner", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  const code = app.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const fn = (() => {
    const at = code.indexOf("const runShadowCalibration = async");
    return code.slice(at, code.indexOf("const runDrain = async", at));
  })();

  it("shadow mode can actually be run", () => {
    expect(fn.length).toBeGreaterThan(400);
    expect(fn).toMatch(/await runShadowPass\(/);
    expect(fn).toMatch(/shadowReport\(\{ runs: \[first, second\], attestedMonths \}\)/);
  });

  it("★★★ TWO passes over the same input — one pass cannot detect run-to-run variance at all", () => {
    // §4.1(3) makes a flapping verdict an automatic fail, and with a single run that check
    // could never fire: one run looks identical to two agreeing runs.
    expect((fn.match(/runShadowPass\(/g) || []).length).toBe(2);
    expect(fn).toMatch(/dryRun: true/);   // the second must not double the stored rows
  });

  it("★★ and it books NOTHING — the whole point of the sequencing decision", () => {
    for (const forbidden of ["persistJournalEntry", "persistMultiLineEntry", "post_journal_entry", "bookToDb", "ensureAccount", "persistRecode"]) {
      expect(fn).not.toContain(forbidden);
    }
  });

  it("★ a failed pass is reported as failed, never as an empty one", () => {
    // runShadowPass throws on a partial write, because a wrong denominator is how a weak
    // result reads as a strong one. This must not turn that into a quiet zero.
    expect(fn).toMatch(/setShadowResult\(\{ error:/);
  });

  it("★ the months it scores against are the SIGNED ones, and a revoked sign-off does not count", () => {
    expect(fn).toMatch(/signoffs \|\| \[\]\)\.filter\(so => so && !so\.revoked_at\)/);
  });
});

describe("★★ and the trigger reaches a screen — otherwise it is the defect it was built to close", () => {
  const view = readFileSync("src/components/views/ReviewView.jsx", "utf8");
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const code = strip(view);
  const card = code.slice(code.indexOf("function ShadowCalibrationCard"));

  it("a reviewer can run it", () => {
    expect(code).toMatch(/<ShadowCalibrationCard \/>/);
    expect(card).toMatch(/runShadowCalibration\(\{ from, to \}\)/);
  });

  it("★ it is on the REVIEWER's screen — the person who reads the verdict signs the months it scores against", () => {
    expect(code).toMatch(/ready && canSignOff && <ShadowCalibrationCard \/>/);
  });

  it("★★ the card books nothing and queries nothing of its own", () => {
    for (const forbidden of ["supabase", "persistJournalEntry", "persistMultiLineEntry", "post_journal_entry", "bookToDb", "persistRecode", ".insert(", ".update("]) {
      expect(card).not.toContain(forbidden);
    }
  });

  it("★★ a failed run says so — it never renders as an empty result", () => {
    // A partial pass makes the denominator wrong, and a wrong denominator is how a weak
    // result reads as a strong one. The error branch must exist and must be its own.
    expect(card).toMatch(/shadowResult\?\.error &&/);
    expect(card).toMatch(/couldn't finish, so there is nothing to read from it/);
  });

  it("★ and it renders the report's own copy rather than re-deriving a sentence", () => {
    expect(card).toMatch(/shadowResult\?\.copy/);
    expect(card).not.toMatch(/PROCEED|STOP|AMBIGUOUS/);   // the verdict is the report's to word
  });
});

describe("★★ the run id must satisfy the column it is written to", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  const code = app.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const fn = code.slice(code.indexOf("const runShadowCalibration = async"), code.indexOf("const runDrain = async"));

  it("★★★ it is a real uuid — `run_id` is a uuid column and a composed string killed the whole pass", () => {
    // Live: `invalid input syntax for type uuid: "3a704760-…-2026-01-01-2026-08-28-a"`. Postgres
    // rejected the first insert, so the run died before scoring a single line. The error copy
    // did its job — it said the check could not finish rather than showing an empty result.
    expect(fn).toMatch(/crypto\.randomUUID\(\)/);
    expect(fn).not.toMatch(/runId: `\$\{runId\}/);        // no composed id
    expect(fn).not.toMatch(/\$\{currentCompany\.id\}-\$\{from\}/);
  });

  it("★ both passes carry their own id, so a stored run can never be ambiguous", () => {
    expect((fn.match(/runId: newRunId\(\)/g) || []).length).toBe(2);
  });

  it("★ and the migration really does type it as uuid — the reason this matters", () => {
    const sql = readFileSync("supabase/migrations/072_calibration_shadow_records.sql", "utf8");
    expect(sql).toMatch(/run_id\s+uuid\s+not null/);
  });
});

describe("★★★ §4.2 — disagreements are ITEMISED, not aggregated", () => {
  const withDisagreements = () => {
    const run = makeRun();
    run.rows[1] = row(1, {
      verdict: "disagree", descriptor_display: "ALAMO FIRE & SAFETY LLC", entity_key: "alamo fire and safety",
      period: "2026-07", attested_account_id: "acct-6250", proposed_account_id: "acct-6700", tier: "universal", propose_basis: "directory_default",
    });
    run.rows[2] = row(2, {
      verdict: "disagree", descriptor_display: "TOAST MERCHANT FEES", entity_key: "toast",
      period: "2026-06", attested_account_id: "acct-6500", proposed_account_id: "acct-6520", tier: "universal", propose_basis: "directory_default",
    });
    run.counts = { agree: 22, park: 0, disagree: 2, phantom: 0 };
    return run;
  };

  it("★★★ each disagreement carries what a person needs to make the call", () => {
    // The spec: "Any DISAGREE is itemised and reviewed one at a time. Not aggregated, not
    // rate-limited." A count cannot be resolved into (a), (b) or (c).
    const r = shadowReport({ runs: [withDisagreements()], attestedMonths: ["2026-07", "2026-08"] });
    expect(r.unresolvedDisagreements.length).toBe(2);
    const d = r.unresolvedDisagreements[0];
    expect(d.descriptor).toBe("ALAMO FIRE & SAFETY LLC");
    expect(d.period).toBe("2026-07");
    expect(d.attestedAccountId).toBe("acct-6250");
    expect(d.proposedAccountId).toBe("acct-6700");
  });

  it("★★ and the copy NAMES them rather than counting them", () => {
    const t = shadowReportCopy(shadowReport({ runs: [withDisagreements()], attestedMonths: ["2026-07", "2026-08"] }));
    expect(t).toMatch(/ALAMO FIRE & SAFETY LLC \(2026-07\)/);
    expect(t).toMatch(/books say acct-6250, the ladder proposed acct-6700/);
    expect(t).toMatch(/TOAST MERCHANT FEES/);
  });

  it("★★ the pass runs TWICE, so an item must not be listed twice", () => {
    // Both passes see the same disagreement; reporting it twice would make the itemised list
    // contradict the count printed beside it.
    const run = withDisagreements();
    const r = shadowReport({ runs: [run, run], attestedMonths: ["2026-07", "2026-08"] });
    expect(r.unresolvedDisagreements.length).toBe(2);
  });

  it("★★★ a merge candidate shows the NAMES — '2 supplier keys' is unanswerable without them", () => {
    const run = makeRun();
    run.rows[1] = row(1, { entity_key: "roma cheese", descriptor_display: "ROMA CHEESE & DAIRY" });
    run.rows[2] = row(2, { entity_key: "roma cheese", descriptor_display: "Roma Cheese Bakery" });
    const t = shadowReportCopy(shadowReport({ runs: [run], attestedMonths: ["2026-07", "2026-08"] }));
    expect(t).toMatch(/one supplier key covers:/);
    expect(t).toMatch(/roma cheese and dairy/i);
    expect(t).toMatch(/roma cheese bakery/i);
    expect(t).toMatch(/same business\?/);
  });
});
