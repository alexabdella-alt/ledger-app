import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  planDrain, planRow, classifyFailure, drainProgressCopy,
  DRAIN_ACTION, DRAIN_SKIP, DRAIN_WAIT, FAILURE_KIND, DRAIN_DEFAULTS,
} from "../src/lib/intakeDrain.js";

// ═════════════════════════════════════════════════════════════════════════════
// O97 STEP 2 — the drain.
//
// ★★ THIS SUITE IS WRITTEN AGAINST A POPULATION THAT DOES NOT EXIST YET.
// Verified live 2026-08-28: ALL 150 document_intake rows have `document_id` NULL, because
// every one predates step 1. So the drain's real input is empty today and will stay empty
// until documents are uploaded under the new ordering.
//
// That is EXACTLY the C195(7) trap — a block whose input is always empty is
// indistinguishable from a block with nothing to do — so the assertions below are
// deliberately POSITIVE (a specific number of picks, a specific census) rather than
// "nothing went wrong", and one test pins that the empty case reports itself HONESTLY
// rather than as "all caught up".
// ═════════════════════════════════════════════════════════════════════════════

const NOW = "2026-08-28T12:00:00.000Z";
const ago = (mins) => new Date(Date.parse(NOW) - mins * 60000).toISOString();

const row = (over = {}) => ({
  id: `i-${Math.random()}`, document_id: "doc-1", status: "received",
  received_at: ago(30), updated_at: ago(30), ...over,
});

describe("★ the planner is pure and owns no clock", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/lib/intakeDrain.js"), "utf8");
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

  it("performs no I/O and reaches no booking primitive", () => {
    expect(code).not.toMatch(/supabase|fetch\(|logAudit|createClient|storeDocument/);
  });

  it("★ refuses to invent a clock — `now` must be supplied", () => {
    // A planner that calls Date.now() cannot be tested at a boundary, and every rule here
    // is a boundary (lease, spacing, give-up).
    expect(code).not.toMatch(/Date\.now\(\)|new Date\(\)/);
    expect(() => planDrain({ rows: [row()] })).toThrow(/now/);
  });
});

describe("★★ the gate step 1 exists to open", () => {
  it("a row with NO durable bytes is SKIPPED and COUNTED — never silently dropped", () => {
    const r = planRow(row({ document_id: null }), { now: NOW });
    expect(r.action).toBe(DRAIN_ACTION.SKIP);
    expect(r.reason).toBe(DRAIN_SKIP.NO_DURABLE_BYTES);
  });

  it("★★ 150 unresumable rows report as UNRESUMABLE, not as an empty queue", () => {
    // The live population on 2026-08-28. A drain that said "nothing to do" here would be
    // describing an empty input as a clean queue — the exact C195(7) failure.
    const legacy = Array.from({ length: 150 }, () => row({ document_id: null, status: "failed" }));
    const plan = planDrain({ rows: legacy, now: NOW });
    expect(plan.counts.pick).toBe(0);
    expect(plan.drainable).toBe(0);
    expect(plan.unresumable).toBe(150);
    expect(plan.reasons["skip:no_durable_bytes"]).toBe(150);
  });

  it("★ and the COPY for that population says they need re-uploading — not 'all caught up'", () => {
    const plan = planDrain({ rows: [row({ document_id: null })], now: NOW });
    const copy = drainProgressCopy({ stored: 1, done: 0, plan, perHour: 20 });
    expect(copy).toMatch(/can't be picked back up|uploading again/);
    expect(copy).not.toMatch(/caught up|all done/i);
  });
});

describe("selection rules", () => {
  it("picks a stored, unprocessed row", () => {
    expect(planRow(row(), { now: NOW }).action).toBe(DRAIN_ACTION.PICK);
  });

  it("terminal rows are skipped", () => {
    for (const s of ["recorded", "held_for_review", "rejected"]) {
      expect(planRow(row({ status: s }), { now: NOW }).reason, s).toBe(DRAIN_SKIP.TERMINAL);
    }
  });

  it("★ a row IN FLIGHT is left alone — the lease is what stops two workers on one file", () => {
    const r = planRow(row({ status: "processing", updated_at: ago(2) }), { now: NOW });
    expect(r.action).toBe(DRAIN_ACTION.WAIT);
    expect(r.reason).toBe(DRAIN_WAIT.IN_FLIGHT);
  });

  it("★ a row whose LEASE EXPIRED is picked back up — a closed tab must not strand a file", () => {
    const r = planRow(row({ status: "processing", updated_at: ago(DRAIN_DEFAULTS.leaseMinutes + 1) }), { now: NOW });
    expect(r.action).toBe(DRAIN_ACTION.PICK);
    expect(r.reason).toBe("lease_expired");
  });

  it("★ spacing holds a just-failed row back — hammering an hourly limit achieves nothing", () => {
    const r = planRow(row({ status: "failed", updated_at: ago(1) }), { now: NOW });
    expect(r.action).toBe(DRAIN_ACTION.WAIT);
    expect(r.reason).toBe(DRAIN_WAIT.TOO_SOON);
  });

  it("★★ GIVE-UP IS EVALUATED BEFORE PICK, so an old row is not retried on its way out", () => {
    const old = row({ received_at: ago(DRAIN_DEFAULTS.giveUpHours * 60 + 60), updated_at: ago(120) });
    const r = planRow(old, { now: NOW });
    expect(r.action).toBe(DRAIN_ACTION.HOLD);
    expect(r.reason).toMatch(/gave_up_after_36h/);
    expect(r.detail).toMatch(/handed to your accountant/);
  });

  it("the give-up box is GENEROUS on purpose — 12 hours of legitimate waiting still picks", () => {
    // 240 documents at 20/hour is twelve hours of healthy queue. A box tight enough to feel
    // decisive would abandon a perfectly normal onboarding.
    expect(planRow(row({ received_at: ago(12 * 60), updated_at: ago(30) }), { now: NOW }).action)
      .toBe(DRAIN_ACTION.PICK);
  });
});

describe("★ transient vs permanent comes from the ERROR, not a counter", () => {
  it("rate limits and network faults are transient", () => {
    expect(classifyFailure({ status: 429 })).toBe(FAILURE_KIND.TRANSIENT);
    expect(classifyFailure({ status: 503 })).toBe(FAILURE_KIND.TRANSIENT);
    expect(classifyFailure(new Error("Rate limit exceeded. You can make 60 AI requests"))).toBe(FAILURE_KIND.TRANSIENT);
    expect(classifyFailure(new Error("fetch failed"))).toBe(FAILURE_KIND.TRANSIENT);
  });

  it("★ anything unrecognised is PERMANENT — the conservative direction", () => {
    // Retrying an unknown failure forever is how a queue becomes a loop. A document held
    // with a stated reason is visible; a document retried forever is not.
    expect(classifyFailure(new Error("could not read PDF"))).toBe(FAILURE_KIND.PERMANENT);
    expect(classifyFailure({ status: 400 })).toBe(FAILURE_KIND.PERMANENT);
    expect(classifyFailure(null)).toBe(FAILURE_KIND.PERMANENT);
  });
});

describe("the pass", () => {
  it("★ serves OLDEST FIRST — newest-first starves the files already waited on", () => {
    const rows = [
      row({ id: "new", received_at: ago(10) }),
      row({ id: "old", received_at: ago(600) }),
      row({ id: "mid", received_at: ago(120) }),
    ];
    const plan = planDrain({ rows, now: NOW, limit: 2 });
    expect(plan.pick.map((p) => p.row.id)).toEqual(["old", "mid"]);
  });

  it("★ the limit DEFERS rather than drops, and says how many", () => {
    const plan = planDrain({ rows: Array.from({ length: 30 }, () => row()), now: NOW, limit: 10 });
    expect(plan.counts.pick).toBe(10);
    expect(plan.counts.deferred).toBe(20);
  });

  it("★ every decision is attributed — a census, not a total", () => {
    const plan = planDrain({
      rows: [
        row(),                                                            // pick
        row({ document_id: null }),                                       // skip
        row({ status: "recorded" }),                                      // skip terminal
        row({ status: "processing", updated_at: ago(1) }),                // wait
        row({ received_at: ago(40 * 60), updated_at: ago(120) }),         // hold
      ],
      now: NOW, limit: 10,
    });
    expect(plan.counts).toMatchObject({ pick: 1, wait: 1, hold: 1, skip: 2 });
    expect(Object.keys(plan.reasons).sort()).toEqual([
      "hold:gave_up_after_36h", "pick:received", "skip:no_durable_bytes", "skip:terminal", "wait:in_flight",
    ]);
  });
});

describe("★★ the copy is derived from the plan, never composed beside it (§9)", () => {
  it("states a finish time when the rate is known — arithmetic, not an estimate", () => {
    const plan = planDrain({ rows: [row()], now: NOW });
    const copy = drainProgressCopy({ stored: 214, done: 38, plan, perHour: 20 });
    expect(copy).toContain("All 214 of your documents are safely stored");
    expect(copy).toContain("sorted 38");
    expect(copy).toMatch(/in about 9 hours/);          // 176 remaining ÷ 20/hr
    expect(copy).toContain("You can close this and come back");
  });

  it("★ OMITS the time when the rate is unknown — never a spinner, never a guess", () => {
    const plan = planDrain({ rows: [row()], now: NOW });
    const copy = drainProgressCopy({ stored: 214, done: 38, plan, perHour: null });
    expect(copy).toContain("safely stored");
    expect(copy).not.toMatch(/hour|minute|soon|shortly/);
  });

  it("★ promises no channel we do not have", () => {
    const plan = planDrain({ rows: [row()], now: NOW });
    const copy = drainProgressCopy({ stored: 10, done: 1, plan, perHour: 20 });
    expect(copy).not.toMatch(/email|notify|text|message you/i);
  });

  it("says nothing rather than something wrong when there is nothing waiting", () => {
    expect(drainProgressCopy({ stored: 0 })).toBe("Nothing waiting.");
  });
});
