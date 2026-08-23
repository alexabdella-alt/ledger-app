import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildAccountInsert } from "../src/lib/writeShapes.js";

// ═════════════════════════════════════════════════════════════════════════════
// O108 finding 4 — THE ABSORBER, HELD AUDIBLE.
//
// The app can CREATE a permanent account on a client's chart at runtime, from FIVE
// separate call sites (the fifth was found by this test, not by reading the code), and until 2026-08-17 every one of them did it silently. On
// Franklin Ave it produced three accounts across attested months — `3400` Opening
// Balance Equity, `6520` Merchant Processing Fees, `6530` Bank Service Charges — none
// of which appear in the live seed OR in `constants.js`. They carry 6 live booked
// lines. Nobody knew the mechanism existed until a migration diff went looking.
//
// The fingerprint is exact and worth keeping: `system_role IS NULL` on an account row
// means IT WAS INVENTED AT RUNTIME, because every seeded account gets a role and
// `buildAccountInsert` hardcodes null. That is the standing detector:
//
//   select code, name, created_at from public.accounts
//   where company_id = :cid and system_role is null order by created_at;
//
// These tests do NOT stop materialisation — that is a deliberate, separate decision
// (removing the fallback converts silent creation into hard failures on live booking
// paths). They hold the LOUDNESS, so the next one is noticed the day it happens
// rather than eight months later.
// ═════════════════════════════════════════════════════════════════════════════

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

describe("(O108) buildAccountInsert — the fingerprint is intentional", () => {
  it("always stamps system_role NULL — this is what makes runtime accounts detectable", () => {
    const row = buildAccountInsert({ companyId: "co1", code: "6520", name: "Merchant Processing Fees" });
    expect(row.system_role).toBe(null);
    expect(row.is_system).toBe(false);
  });

  it("an unknown code silently becomes an EXPENSE — the category is a guess, and a real one", () => {
    // `category: category || "Expenses"`. A code the chart has never heard of is filed as an
    // expense whatever it actually is. Recorded rather than changed: 6520/6530 genuinely were
    // expenses, so this has not yet produced a wrong classification — but it would, silently.
    expect(buildAccountInsert({ companyId: "c", code: "9999", name: "?" }).category).toBe("Expenses");
    expect(buildAccountInsert({ companyId: "c", code: "1", name: "?", category: "Assets" }).category).toBe("Assets");
  });

  it("carries the code and name through unchanged", () => {
    expect(buildAccountInsert({ companyId: "c", code: "6530", name: "Bank Service Charges" }))
      .toMatchObject({ company_id: "c", code: "6530", name: "Bank Service Charges", active: true });
  });
});

describe("(O108) every materialisation site is AUDIBLE", () => {
  const app = read("src/App.jsx");

  // O110 — WIDENED 2026-08-23 FROM App.jsx TO ALL OF src/. The original guard read only
  // App.jsx and reported "all five sites covered", which was true and useless: the SIXTH
  // site lived in QBOImportView.jsx, had been silently broken for months, and the guard
  // was structurally incapable of seeing it. A test that scopes itself to where you
  // already looked will always tell you that you have looked everywhere.
  const srcFiles = (function walk(d, acc = []) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, acc);
      else if (/\.jsx?$/.test(e.name)) acc.push(full);
    }
    return acc;
  })(path.join(process.cwd(), "src"));

  it("★ EVERY buildAccountInsert call site in src/ logs an audit event", () => {
    const sites = [];
    for (const f of srcFiles) {
      const t = fs.readFileSync(f, "utf8");
      // Skip the DEFINITION in writeShapes.js — `export function buildAccountInsert(` is
      // not a call site, and counting it would make the expected number a lie.
      for (const m of t.matchAll(/(?<!function )buildAccountInsert\(/g)) {
        sites.push({ file: path.relative(process.cwd(), f), i: m.index, t });
      }
    }
    // 5 in App.jsx + 1 in QBOImportView.jsx. writeShapes.js defines it; it does not call it.
    expect(sites.length, `sites: ${sites.map((s) => s.file).join(", ")}`).toBe(6);
    for (const s of sites) {
      expect(s.t.slice(s.i, s.i + 900), `${s.file}@${s.i} has no account_materialized audit within 900 chars`)
        .toMatch(/logAudit\("account_materialized"/);
    }
  });

  it("★ no RAW account insert bypasses the shared shape — the door O110 came through", () => {
    // QBOImportView.jsx:115 was `supabase.from("accounts").insert({ … })` by hand, with a
    // column that did not exist and no system_role. Any future hand-rolled account insert
    // is invisible to the guard above, so forbid the shape itself.
    const offenders = [];
    for (const f of srcFiles) {
      const t = fs.readFileSync(f, "utf8");
      for (const m of t.matchAll(/from\(\s*["']accounts["']\s*\)\s*\n?\s*\.insert\(\s*\{/g)) {
        offenders.push(`${path.relative(process.cwd(), f)}@${m.index}`);
      }
    }
    // addCustomAccount (App.jsx) is the one sanctioned hand-rolled insert: it is the
    // explicit "user adds an account" path, sets system_role: null deliberately, and is
    // audited as `coa_added` rather than `account_materialized`.
    expect(offenders.length, `raw accounts inserts: ${offenders.join(", ")}`).toBeLessThanOrEqual(1);
  });

  it("names WHICH site fired — three distinct sites, so the audit trail is diagnosable", () => {
    for (const site of ["ensureAccount", "ensureAccountIdForCode", "persistRecode", "resolveAccountId"]) {
      expect(app).toMatch(new RegExp(`site: "${site}"`));
    }
  });

  it("the audit copy is a query-claim about what WE did, not a claim about the chart", () => {
    // Q9 doctrine: "it was not in this company's chart" is what we looked for and didn't find.
    // "this account doesn't exist" would be a claim about the world.
    const msgs = [...app.matchAll(/logAudit\("account_materialized", `([^`]*)`/g)].map((m) => m[1]);
    expect(msgs.length).toBeGreaterThanOrEqual(3);
    for (const m of msgs) {
      expect(m, m).toMatch(/was not in this company's chart/);
      expect(m, m).not.toMatch(/does not exist|invalid|unknown account/i);
    }
  });
});

describe("(O108) the role fallback is audible, and still a fallback", () => {
  const hook = read("src/hooks/useAccounts.js");

  it("warns when it falls back to the built-in chart", () => {
    expect(hook).toMatch(/WARNED_ROLE_FALLBACKS/);
    expect(hook).toMatch(/console\.warn\(\s*\n?\s*`\[accounts\] O108:/);
  });

  it("warns ONCE PER ROLE and only after accounts load — a warning per render is noise", () => {
    expect(hook).toMatch(/WARNED_ROLE_FALLBACKS\.has\(role\)/);
    expect(hook).toMatch(/accounts\.length/);
  });

  it("★ BEHAVIOUR UNCHANGED — it still returns the fallback, it does not throw or null out", () => {
    // The loudness work must not become a behaviour change by accident. Removing the
    // fallback is a separate decision with its own blast radius (live booking paths would
    // start failing hard); this commit is instrumentation only.
    expect(hook).toMatch(/const fallback = DEFAULT_BY_ROLE\[role\] \|\| null;/);
    expect(hook).toMatch(/return fallback;/);
    expect(hook).not.toMatch(/throw new Error/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// O108 — THE GUARD THAT WOULD HAVE CAUGHT THE WHOLE THING.
//
// The client chart (`constants.js`) and the SEED that creates a company's chart must
// describe the same accounts. Nothing checked that, which is how `044` sat in the tree
// for months describing a chart the database had never had, and how `6520`/`6530` came
// to exist in live charts and in no definition at all.
//
// This reads the HIGHEST-NUMBERED migration that defines `seed_company_accounts` and
// diffs its roles against `constants.js`. It is deliberately self-maintaining: write a
// new seed migration and this test starts checking that one.
// ─────────────────────────────────────────────────────────────────────────────
describe("(O108) the client chart and the newest seed migration agree", () => {
  const dir = path.join(process.cwd(), "supabase/migrations");
  const seedFile = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && /^\d/.test(f))
    // Must DEFINE the function with a values list — 069 only revokes a grant on it,
    // and mentioning the name is not defining the chart. (Caught by this test on the
    // first run, which is the smallest possible version of the O108 lesson.)
    .filter((f) => {
      const t = fs.readFileSync(path.join(dir, f), "utf8");
      return /create or replace function public\.seed_company_accounts/i.test(t) && /from \(values/i.test(t);
    })
    .sort()
    .pop();

  it("a seed-defining migration exists to check against", () => {
    expect(seedFile, "no migration defines seed_company_accounts").toBeTruthy();
  });

  it("★ every role in the newest seed is in constants.js, and vice versa", () => {
    const sql = fs.readFileSync(path.join(dir, seedFile), "utf8");
    const fn = sql.slice(sql.search(/function public\.seed_company_accounts/i));
    const values = fn.slice(fn.indexOf("from (values"), fn.indexOf(") as v("));
    const seedRoles = new Set([...values.matchAll(/','([a-z_]+)'\)/g)].map((m) => m[1]));
    const clientRoles = new Set(
      [...read("src/lib/constants.js").matchAll(/system_role:\s*"([a-z_]+)"/g)].map((m) => m[1]),
    );
    const missingFromClient = [...seedRoles].filter((r) => !clientRoles.has(r)).sort();
    const missingFromSeed = [...clientRoles].filter((r) => !seedRoles.has(r)).sort();
    expect(missingFromClient, `in ${seedFile} but not constants.js`).toEqual([]);
    expect(missingFromSeed, `in constants.js but not ${seedFile}`).toEqual([]);
    expect(seedRoles.size).toBeGreaterThan(50);   // sanity: the parse actually found the list
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MIGRATION FILE SANITY (requested 2026-08-17).
//
// HONEST SCOPE, STATED FIRST: this would NOT have caught the reported defect. The
// operator hit an unparseable bare `=====` on line 1 of 068/069 in the SQL editor and
// fixed it by hand — but the COMMITTED blobs both begin `-- =====` (verified byte-wise
// via `git show HEAD:…`), and every migration in the tree passes the check below. The
// `--` was lost somewhere between the file and the editor, in a step no test can see.
//
// Kept anyway because it is cheap and the class is real: a migration whose first line
// is not a comment or SQL will fail at the point of most consequence, against
// production, by hand. A guard that cannot catch the incident that prompted it is
// worth having only if you say so out loud — otherwise it is the ·3a pattern again,
// a test that reassures without testing.
// ─────────────────────────────────────────────────────────────────────────────
describe("migration files are parseable at a glance", () => {
  const dir = path.join(process.cwd(), "supabase/migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql"));

  it("there are migrations to check", () => expect(files.length).toBeGreaterThan(50));

  it("★ line 1 is a comment or SQL — never a bare rule", () => {
    const bad = files.filter((f) => {
      const first = fs.readFileSync(path.join(dir, f), "utf8").split("\n")[0].trim();
      return first !== "" && !/^(--|\/\*|begin|set|create|alter|insert|update|drop|revoke|grant|do|with|comment)/i.test(first);
    });
    expect(bad, "first line parses as neither comment nor SQL").toEqual([]);
  });

  it("no unterminated dollar-quote — the other way a paste dies mid-statement", () => {
    for (const f of files) {
      const t = fs.readFileSync(path.join(dir, f), "utf8");
      for (const tag of ["$fn$", "$function$", "$$"]) {
        const n = t.split(tag).length - 1;
        expect(n % 2, `${f}: odd number of ${tag} delimiters (${n})`).toBe(0);
      }
    }
  });

  it("every file that opens a transaction closes it", () => {
    for (const f of files) {
      const t = fs.readFileSync(path.join(dir, f), "utf8").toLowerCase();
      const begins = (t.match(/^\s*begin;/gm) || []).length;
      const commits = (t.match(/^\s*commit;/gm) || []).length;
      expect(commits, `${f}: ${begins} begin; vs ${commits} commit;`).toBe(begins);
    }
  });
});
