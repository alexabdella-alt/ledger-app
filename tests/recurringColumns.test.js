// C525 — every column the app WRITES to recurring_transactions exists in the table, and the run
// record uses the table's own name. `recordRecurringRun` (C360) wrote `last_run`; the column is
// `last_run_date`, so PostgREST refused the update on every "Post now" since it shipped. The C360
// test pinned the writer's literal against itself (·3a) and never asked the schema.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { buildRecurringRow, recurringRunPatch } from "../src/lib/chatActions.js";

const ddl = fs.readFileSync("supabase/migrations/000_baseline_schema.sql", "utf8");
const columnsOf = (table) => {
  const at = ddl.indexOf(`CREATE TABLE public.${table} (`);
  expect(at).toBeGreaterThan(-1);
  const body = ddl.slice(at, ddl.indexOf("\n);", at));
  const cols = [...body.matchAll(/^\s{4}([a-z_]+)\s/gm)].map(m => m[1]).filter(c => !["CONSTRAINT", "PRIMARY", "UNIQUE", "CHECK"].includes(c));
  expect(cols.length).toBeGreaterThan(5);   // the parse must have found the table
  return new Set(cols);
};
const cols = columnsOf("recurring_transactions");

describe("C525 — recurring_transactions writers match the table", () => {
  it("THE REPRO — `last_run` is not a column; `last_run_date` is", () => {
    expect(cols.has("last_run")).toBe(false);
    expect(cols.has("last_run_date")).toBe(true);
  });
  it("the run patch writes the table's column, and carries the next date", () => {
    const p = recurringRunPatch({ last_run: "2026-09-15", next_date: "2026-10-15" });
    expect(p).toEqual({ last_run_date: "2026-09-15", next_date: "2026-10-15" });
    for (const k of Object.keys(p)) expect(cols.has(k), `column ${k}`).toBe(true);
  });
  it("every key the insert writes is a column — including project, which the load now reads back", () => {
    const row = buildRecurringRow({ companyId: "c", name: "Rent", amount: 2400, debitAccountId: "a", creditAccountId: "b", frequency: "monthly", nextDate: "2026-10-01", project: "Main" });
    for (const k of Object.keys(row)) expect(cols.has(k), `column ${k}`).toBe(true);
    const app = fs.readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/last_run: r\.last_run_date,\s*\n\s*project: r\.project \|\| "General"/);
  });
});
