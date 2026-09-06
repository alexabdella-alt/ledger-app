import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

// ── WHAT THIS GUARDS ─────────────────────────────────────────────────────────
// `fetchIntakeRows` selected `created_at` from a table whose column is `received_at`.
// PostgREST errors on a select naming a column that does not exist, so the fetch returned
// ok:false on EVERY company, and the completeness net has never once run. It surfaced as
// "we couldn't check your documents just now" — honest about the query, and wrong about
// the duration: a permanent failure wearing transient clothing is never investigated.
//
// ★ A COLUMN NAME IS A CONTRACT WITH THE SCHEMA, AND NOTHING WAS CHECKING IT. The build
// cannot see inside a string, and a unit test with a hand-made fixture supplies whatever
// the reader asks for — the ·3a shape, where both sides agree and neither matches the
// database. This reads the real DDL.

const SRC = readFileSync(new URL("../src/lib/documentIntake.js", import.meta.url), "utf8");
const MIG = readFileSync(new URL("../supabase/migrations/047_document_intake_ledger.sql", import.meta.url), "utf8");

// Columns as the migration actually declares them.
const ddl = MIG.slice(MIG.indexOf("create table if not exists public.document_intake"));
const body = ddl.slice(ddl.indexOf("("), ddl.indexOf("\n);"));
const COLUMNS = new Set(
  body.split("\n").map(l => l.trim())
    .filter(l => l && !l.startsWith("--") && !/^(constraint|check|primary|unique|foreign)\b/i.test(l))
    .map(l => l.split(/\s+/)[0].replace(/[(),]/g, ""))
    .filter(c => /^[a-z_][a-z0-9_]*$/.test(c)),
);

// Every `.from("document_intake").select("…")` in the module.
const selects = [...SRC.matchAll(/from\("document_intake"\)\s*\n?\s*\.select\("([^"]+)"\)/g)].map(m => m[1]);

describe("every column these queries select exists on the table", () => {
  it("★ the DDL parsed, and it holds the columns we expect", () => {
    // Refuses to pass vacuously: an empty column set would clear every select below.
    expect(COLUMNS.size).toBeGreaterThan(8);
    expect(COLUMNS.has("received_at")).toBe(true);
    expect(COLUMNS.has("created_at")).toBe(false);   // the column that never existed
  });

  it("★ and at least two selects were found to check", () => {
    expect(selects.length).toBeGreaterThanOrEqual(2);
  });

  it("★★ NO SELECT NAMES A COLUMN THE TABLE DOES NOT HAVE — the live bug", () => {
    const bad = [];
    for (const sel of selects) {
      for (const raw of sel.split(",")) {
        const col = raw.trim();
        if (col && col !== "*" && !COLUMNS.has(col)) bad.push(col);
      }
    }
    expect(bad).toEqual([]);
  });

  it("★★ and the completeness fetch asks for the column its READER reads", () => {
    // staleIntakeRows ages each row from `received_at`. Fetching without it would leave the
    // query succeeding while every row aged from `now` — the window never firing, and the
    // net reporting all-clear while doing nothing. Worse than the error it replaced.
    expect(SRC).toMatch(/r\.received_at/);
    const fetchSel = selects.find(s => s.includes("journal_entry_ids"));
    expect(fetchSel, "the completeness select").toBeTruthy();
    expect(fetchSel).toContain("received_at");
  });

  it("★ a failed check says why, rather than only that it failed", () => {
    // The caller records ok/not-ok and discards the message, so without this the failure
    // had nowhere to be seen — invisible for as long as it existed.
    expect(SRC).toMatch(/console\.error\("\[intake\] completeness check could not run:/);
  });
});
