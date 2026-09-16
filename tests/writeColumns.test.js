// ═════════════════════════════════════════════════════════════════════════════
// C525 — A STANDING CENSUS: EVERY COLUMN THE APP WRITES EXISTS ON THE TABLE IT WRITES TO.
// Twice this month a writer named a column the table does not have and nothing said so until a
// person read the file: `fetchIntakeRows` selected `created_at` from a table whose column is
// `received_at` (C308 — the completeness net had never run), and `recordRecurringRun` wrote
// `last_run` to a table whose column is `last_run_date` (C525 — no recurring charge ever advanced).
// The build cannot see inside a string; a unit test with a hand-made fixture supplies whatever
// the writer asks for (·3a). So the writes are parsed out of `src/` and held to the DDL — the
// baseline plus every later `add column`.
// ═════════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const MIG = "supabase/migrations";
const columns = new Map();
const add = (t, c) => { if (!columns.has(t)) columns.set(t, new Set()); columns.get(t).add(c); };
{
  const base = fs.readFileSync(path.join(MIG, "000_baseline_schema.sql"), "utf8");
  for (const m of base.matchAll(/CREATE TABLE public\.([a-z_0-9]+) \(([\s\S]*?)\n\);/g)) {
    for (const c of m[2].matchAll(/^\s{4}([a-z_0-9]+)\s/gm)) add(m[1], c[1]);
  }
  for (const f of fs.readdirSync(MIG).filter(f => f.endsWith(".sql") && !f.startsWith("000_")).sort()) {
    const t = fs.readFileSync(path.join(MIG, f), "utf8");
    for (const m of t.matchAll(/create table if not exists (?:public\.)?([a-z_0-9]+)\s*\(([\s\S]*?)\n\);/gi)) {
      for (const c of m[2].matchAll(/^\s*([a-z_0-9]+)\s/gm)) add(m[1], c[1]);
    }
    for (const m of t.matchAll(/alter table (?:public\.)?([a-z_0-9]+)((?:\s*add column (?:if not exists )?[a-z_0-9]+[^,;]*,?)+)/gi)) {
      for (const c of m[2].matchAll(/add column (?:if not exists )?([a-z_0-9]+)/gi)) add(m[1], c[1]);
    }
  }
}

// Top-level keys of an object literal: strip the outer braces, then blank every nested object
// (innermost first — `|| {}` inside a spread is an object too) so a key inside
// `import_metadata: {...}` is not read as a column.
const topKeys = (lit) => {
  let body = lit.trim().replace(/^\{/, "").replace(/\}$/, ""), prev;
  do { prev = body; body = body.replace(/\{[^{}]*\}/g, "0"); } while (body !== prev);
  return [...body.matchAll(/(?:^|,)\s*([a-z_0-9]+)\s*:/g)].map(m => m[1]);
};
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (/\.jsx?$/.test(e.name)) out.push(p); } return out; };
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// The literal starting at `{` — brace-balanced, so a nested import_metadata object cannot end
// the capture early and leak its keys to the top level.
const literalAt = (s, i) => { let d = 0; for (let j = i; j < s.length; j++) { if (s[j] === "{") d++; else if (s[j] === "}") { d--; if (d === 0) return s.slice(i, j + 1); } } return null; };
const sites = [];   // { file, table, keys }
for (const f of walk("src")) {
  const s = strip(fs.readFileSync(f, "utf8"));
  for (const m of s.matchAll(/from\("([a-z_0-9]+)"\)\s*\.(?:insert|update|upsert)\(\s*\{/g)) { const lit = literalAt(s, m.index + m[0].length - 1); if (lit) sites.push({ file: f, table: m[1], keys: topKeys(lit) }); }
  for (const m of s.matchAll(/table:\s*"([a-z_0-9]+)"[\s\S]{0,300}?patch:\s*\{/g)) { const lit = literalAt(s, m.index + m[0].length - 1); if (lit) sites.push({ file: f, table: m[1], keys: topKeys(lit) }); }
}

describe("C525 — write columns exist", () => {
  it("topKeys reads only the top level (a nested import_metadata key is not a column)", () => {
    expect(topKeys(`{ import_metadata: { ...(x || {}), invoice_attached: true, nested: { deep: 1 } }, reference_number: r, status: "posted" }`)).toEqual(["import_metadata", "reference_number", "status"]);
    expect(topKeys(`{ last_run: a, next_date: b }`)).toEqual(["last_run", "next_date"]);
  });
  it("the DDL parse found the tables (anti-vacuity)", () => {
    expect(columns.size).toBeGreaterThan(30);
    expect(columns.get("recurring_transactions").has("last_run_date")).toBe(true);
    expect(columns.get("document_intake").has("received_at")).toBe(true);
    expect(columns.get("documents").has("document_date")).toBe(true);   // added by 077, not the baseline
  });
  it("the source scan found the writes (anti-vacuity)", () => {
    expect(sites.length).toBeGreaterThan(15);
  });
  it("every top-level key of every inline write literal is a column of its table", () => {
    const bad = [];
    for (const s of sites) {
      const cols = columns.get(s.table);
      if (!cols) continue;   // a table the migrations do not declare (views, RPC payloads) is not this test's to judge
      for (const k of s.keys) if (!cols.has(k)) bad.push(`${s.file} → ${s.table}.${k}`);
    }
    expect(bad).toEqual([]);
  });
  it("the two writers that shipped wrong are held by name", () => {
    expect(columns.get("recurring_transactions").has("last_run")).toBe(false);
    expect(columns.get("document_intake").has("created_at")).toBe(false);
  });
});
