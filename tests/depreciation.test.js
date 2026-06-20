import { describe, it, expect } from "vitest";
import { depreciableBase, buildDepreciationEntry, buildDepreciationSchedule, suggestUsefulLifeMonths, planDepreciationRun } from "../src/lib/depreciation.js";

const DEP = "6900", ACC = "1510";
const sumD = ls => ls.reduce((s, l) => s + (l.debit || 0), 0);
const sumC = ls => ls.reduce((s, l) => s + (l.credit || 0), 0);

describe("depreciableBase — cost less salvage, floored at 0", () => {
  it("subtracts salvage", () => expect(depreciableBase(12000, 2000)).toBe(10000));
  it("defaults salvage to 0", () => expect(depreciableBase(5000)).toBe(5000));
  it("never negative", () => expect(depreciableBase(1000, 5000)).toBe(0));
});

describe("buildDepreciationEntry — Dr 6900 / Cr 1510, balanced", () => {
  it("posts the period entry", () => {
    const je = buildDepreciationEntry({ amount: 200, depExpCode: DEP, accumDepCode: ACC, date: "2026-03-31" });
    expect(je.balanced).toBe(true);
    expect(je.lines).toEqual([
      { code: DEP, name: null, debit: 200, credit: 0, memo: null },
      { code: ACC, name: null, debit: 0, credit: 200, memo: null },
    ]);
  });
  it("returns null on zero/invalid amount or missing accounts", () => {
    expect(buildDepreciationEntry({ amount: 0, depExpCode: DEP, accumDepCode: ACC })).toBe(null);
    expect(buildDepreciationEntry({ amount: 100, depExpCode: DEP })).toBe(null);
  });
});

describe("buildDepreciationSchedule — straight-line monthly", () => {
  // $12,000 asset, $0 salvage, 60-month (5yr) life → $200/mo for 60 months.
  const s = buildDepreciationSchedule({
    cost: 12000, salvage: 0, lifeMonths: 60, inServiceDate: "2026-01-15",
    depExpCode: DEP, accumDepCode: ACC, assetLabel: "MacBook", assetId: "a1",
  });

  it("produces one entry per month for the full life", () => {
    expect(s.months).toBe(60);
    expect(s.entries).toHaveLength(60);
    expect(s.monthly).toBe(200);
  });
  it("every entry is a balanced Dr 6900 / Cr 1510", () => {
    for (const je of s.entries) {
      expect(je.balanced).toBe(true);
      expect(je.lines[0].code).toBe(DEP);
      expect(je.lines[1].code).toBe(ACC);
      expect(sumD(je.lines)).toBe(sumC(je.lines));
    }
  });
  it("Σ schedule === depreciable base exactly (accum dep lands on base, no drift)", () => {
    const total = s.entries.reduce((t, je) => t + je.lines[0].debit, 0);
    expect(Math.round(total * 100) / 100).toBe(12000);
    expect(s.total).toBe(12000);
  });
  it("steps the date one month at a time from in-service date", () => {
    expect(s.entries[0].date).toBe("2026-01-15");
    expect(s.entries[1].date).toBe("2026-02-15");
    expect(s.entries[11].date).toBe("2026-12-15");
  });
  it("salvage reduces the depreciable base", () => {
    const s2 = buildDepreciationSchedule({ cost: 12000, salvage: 2000, lifeMonths: 10, inServiceDate: "2026-01-01", depExpCode: DEP, accumDepCode: ACC });
    expect(s2.total).toBe(10000);
    expect(s2.monthly).toBe(1000);
  });
  it("the last month absorbs the rounding remainder (Σ exact even when base/n doesn't divide evenly)", () => {
    // $1,000 / 3 months = 333.33, 333.33, 333.34 → Σ 1000.00
    const s3 = buildDepreciationSchedule({ cost: 1000, salvage: 0, lifeMonths: 3, inServiceDate: "2026-01-01", depExpCode: DEP, accumDepCode: ACC });
    const amts = s3.entries.map(je => je.lines[0].debit);
    expect(amts).toEqual([333.33, 333.33, 333.34]);
    expect(s3.total).toBe(1000);
  });
  it("degenerate inputs → empty schedule (no life, no base, no in-service date)", () => {
    expect(buildDepreciationSchedule({ cost: 12000, lifeMonths: 0, inServiceDate: "2026-01-01", depExpCode: DEP, accumDepCode: ACC }).entries).toEqual([]);
    expect(buildDepreciationSchedule({ cost: 0, lifeMonths: 60, inServiceDate: "2026-01-01", depExpCode: DEP, accumDepCode: ACC }).entries).toEqual([]);
    expect(buildDepreciationSchedule({ cost: 12000, lifeMonths: 60, depExpCode: DEP, accumDepCode: ACC }).entries).toEqual([]);
  });
});

describe("suggestUsefulLifeMonths — AI-suggested standard lives (capture default)", () => {
  it("computers/tech → 5yr", () => expect(suggestUsefulLifeMonths("Apple MacBook Pro laptop")).toBe(60));
  it("vehicles → 5yr", () => expect(suggestUsefulLifeMonths("Ford delivery truck")).toBe(60));
  it("furniture/equipment → 7yr", () => expect(suggestUsefulLifeMonths("office desk and chair")).toBe(84));
  it("buildings → 39yr", () => expect(suggestUsefulLifeMonths("warehouse building")).toBe(468));
  it("unknown → 5yr default", () => expect(suggestUsefulLifeMonths("misc asset")).toBe(60));
});

describe("planDepreciationRun — which rows post, which assets flip (periodic posting)", () => {
  // Two assets' pending schedules.
  const rows = [
    { id: "a1m1", asset_id: "A", period_index: 1, period_date: "2026-01-31", amount: 100, status: "pending" },
    { id: "a1m2", asset_id: "A", period_index: 2, period_date: "2026-02-28", amount: 100, status: "pending" },
    { id: "a1m3", asset_id: "A", period_index: 3, period_date: "2026-03-31", amount: 100, status: "pending" },
    { id: "b1m1", asset_id: "B", period_index: 1, period_date: "2026-02-15", amount: 50, status: "pending" },
    { id: "b1m2", asset_id: "B", period_index: 2, period_date: "2026-03-15", amount: 50, status: "pending" },
    { id: "done", asset_id: "A", period_index: 0, period_date: "2025-12-31", amount: 100, status: "posted" }, // already posted → ignored
  ];

  it("posts only PENDING rows due on/before the cutoff, date-ordered", () => {
    const { due } = planDepreciationRun(rows, "2026-02-28");
    expect(due.map(r => r.id)).toEqual(["a1m1", "b1m1", "a1m2"]);   // Jan31, Feb15, Feb28
  });

  it("no asset flips when months remain pending after the run", () => {
    const { assetsToFlip } = planDepreciationRun(rows, "2026-02-28");
    expect(assetsToFlip).toEqual([]);   // A has month 3 left, B has month 2 left
  });

  it("an asset flips to fully_depreciated only when its LAST pending row posts in this run", () => {
    const { due, assetsToFlip } = planDepreciationRun(rows, "2026-03-15");
    // through Mar 15: A months 1-2 (m3 is Mar31, still pending) ; B months 1-2 (all) → B flips, A doesn't
    expect(due.map(r => r.id)).toEqual(["a1m1", "b1m1", "a1m2", "b1m2"]);
    expect(assetsToFlip).toEqual(["B"]);
  });

  it("running through the end posts every remaining month and flips all assets", () => {
    const { due, assetsToFlip } = planDepreciationRun(rows, "2026-12-31");
    expect(due).toHaveLength(5);
    expect(assetsToFlip.sort()).toEqual(["A", "B"]);
  });
});

describe("integration (pure): capture → schedule → periodic posting → fully-depreciated", () => {
  // $1,200 asset, 12-month life, no salvage → $100/mo.
  const sched = buildDepreciationSchedule({ cost: 1200, salvage: 0, lifeMonths: 12, inServiceDate: "2026-01-15", depExpCode: DEP, accumDepCode: ACC, assetId: "X" });
  // The DB schedule rows the app would insert.
  const rows = sched.entries.map((je, i) => ({
    id: `X${i + 1}`, asset_id: "X", period_index: i + 1, period_date: je.date, amount: je.lines[0].debit, status: "pending",
  }));

  it("schedule sums to cost and is 12 months", () => {
    expect(sched.total).toBe(1200);
    expect(rows).toHaveLength(12);
  });

  it("a partial run posts the elapsed months and accumulates the right depreciation", () => {
    const { due, assetsToFlip } = planDepreciationRun(rows, "2026-06-15");   // Jan15..Jun15 = 6 months
    expect(due).toHaveLength(6);
    const accumulated = due.reduce((s, r) => s + r.amount, 0);
    expect(accumulated).toBe(600);          // 6 × $100 = Accumulated Depreciation after the run
    expect(assetsToFlip).toEqual([]);       // 6 months still pending
  });

  it("the final run posts the remainder and flips the asset; total accum === depreciable base", () => {
    // simulate the first 6 posted
    const afterFirst = rows.map(r => (r.period_index <= 6 ? { ...r, status: "posted" } : r));
    const { due, assetsToFlip } = planDepreciationRun(afterFirst, "2026-12-31");
    expect(due).toHaveLength(6);
    expect(assetsToFlip).toEqual(["X"]);    // last pending row posts → fully depreciated
    const totalAccum = rows.reduce((s, r) => s + r.amount, 0);
    expect(totalAccum).toBe(1200);          // accumulated depreciation lands exactly on cost − salvage
  });
});
