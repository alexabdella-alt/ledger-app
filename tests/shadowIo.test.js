import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runShadowPass, readShadowInputs } from "../src/lib/shadowIo.js";

// ═════════════════════════════════════════════════════════════════════════════
// C201 — the shadow I/O shell. Thin by design, and the tests are mostly about the
// SURFACE rather than the logic, because the surface is the safety property:
// shadowRun.js cannot decide to book; this file has nowhere to book to.
// ═════════════════════════════════════════════════════════════════════════════

const code = (f) => fs.readFileSync(path.join(process.cwd(), f), "utf8")
  .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

describe("★★ the write surface is one table", () => {
  const src = code("src/lib/shadowIo.js");

  it("every insert/update/delete targets calibration_shadow_records", () => {
    const writes = [...src.matchAll(/\.from\(([^)]*)\)[\s\S]{0,120}?\.(insert|update|delete|upsert)\(/g)];
    expect(writes.length, "expected exactly one write site").toBe(1);
    expect(writes[0][1]).toBe("SHADOW_TABLE");
    expect(src).toMatch(/const SHADOW_TABLE = "calibration_shadow_records"/);
  });

  it("no booking primitive is reachable by name", () => {
    for (const f of ["journal_entries", "journal_entry_lines\"", "persistJournalEntry", "post_journal_entry",
                     "bookToDb", "buildAccountInsert", "ensureAccount", "markBillPaid"]) {
      // journal_entry_lines appears in the READ query only — asserted separately below.
      if (f === "journal_entry_lines\"") continue;
      expect(src, f).not.toMatch(new RegExp(`\\.(insert|update|delete|upsert|rpc)\\([^)]*${f}`));
    }
    expect(src).not.toMatch(/\.rpc\(/);
  });

  it("the client is INJECTED, never imported — a module that reaches for its own can widen its own surface", () => {
    const full = fs.readFileSync(path.join(process.cwd(), "src/lib/shadowIo.js"), "utf8");
    expect(full.match(/^import .* from "([^"]+)";$/gm)).toEqual(['import { planShadowRun } from "./shadowRun.js";']);
    expect(src).not.toMatch(/createClient|from "\.\/supabase/);
  });

  it("only 072's columns are posted — a report-only field must not reach the insert", () => {
    // `propose_basis` is produced by the planner for the report and is NOT a column.
    // Posting it would make PostgREST reject the whole batch, and the run would look
    // like a failure of shadow mode rather than of the writer.
    expect(src).toMatch(/const ROW_COLUMNS = \[/);
    expect(src).not.toMatch(/propose_basis/);
  });
});

// A minimal thenable query-builder double. supabase-js builders are thenable, so a
// fake that only implements the methods and not the `then` never reaches the code
// under test — the first version of these tests failed on the double, not the module.
const q = (result) => {
  const o = {};
  for (const m of ["select", "eq", "gte", "lte", "order", "limit"]) o[m] = () => o;
  o.insert = () => ({ select: () => Promise.resolve(result) });
  o.then = (res) => res(result);
  return o;
};
const client = (per = {}) => ({ from: (t) => q(per[t] ?? { data: [], error: null }) });

describe("a partial write is a failed run, not a small one", () => {
  it("★ a read error stops the run — never plan on partial data", async () => {
    await expect(readShadowInputs({
      supabase: client({ accounts: { data: null, error: { message: "nope" } } }),
      companyId: "c", from: "2026-01-01", to: "2026-12-31",
    })).rejects.toThrow(/read failed/);
  });

  it("★ a write error throws — a wrong denominator reads as a strong result", async () => {
    const lines = [{ id: "L1", account_id: "a1", debit: 10,
      journal_entries: { entry_date: "2026-07-02", description: "Roma – ACH DEBIT - ROMA CHEESE & DAIRY CO", source: "bank_import", deleted_at: null } }];
    const supabase = client({
      journal_entry_lines: { data: lines, error: null },
      period_signoffs: { data: [{ period: "2026-07" }], error: null },
      accounts: { data: [{ id: "a1", code: "5000", system_role: "cogs" }], error: null },
      calibration_shadow_records: { data: null, error: { message: "boom" } },
    });
    await expect(runShadowPass({ supabase, companyId: "c", runId: "r", from: "2026-01-01", to: "2026-12-31" }))
      .rejects.toThrow(/write failed/);
  });

  it("dryRun plans and writes nothing", async () => {
    const out = await runShadowPass({ supabase: client(), companyId: "c", runId: "r",
      from: "2026-01-01", to: "2026-12-31", dryRun: true });
    expect(out).toMatchObject({ written: 0, dryRun: true });
  });

  it("a clean pass writes every planned row and reports the count", async () => {
    const lines = [{ id: "L1", account_id: "a1", debit: 10,
      journal_entries: { entry_date: "2026-07-02", description: "Roma – ACH DEBIT - ROMA CHEESE & DAIRY CO", source: "bank_import", deleted_at: null } }];
    const supabase = client({
      journal_entry_lines: { data: lines, error: null },
      period_signoffs: { data: [{ period: "2026-07" }], error: null },
      accounts: { data: [{ id: "a1", code: "5000", system_role: "cogs" }], error: null },
      calibration_shadow_records: { data: [{ id: "x" }], error: null },
    });
    const out = await runShadowPass({ supabase, companyId: "c", runId: "r", from: "2026-01-01", to: "2026-12-31" });
    expect(out.written).toBe(1);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].verdict).toBe("park");   // unknown vendor, no state, no directory hit
  });
});
