import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../src/lib/constants.js";

// ═════════════════════════════════════════════════════════════════════════════
// O35 — THE PER-COMPANY ROLE AUDIT, AND THE GUARD THAT KEEPS IT HONEST.
//
// Companies were seeded by different chart versions over time, so an older one can hold an
// account the app cannot FIND: every role-resolved feature looks up a `system_role`, and a
// v1-era account has NULL there. The account is on the balance sheet and invisible to the
// code.
//
// ★★★ THE AUDIT CARRIES A COPY OF THE CANONICAL ROLE LIST, AND A COPY IS THE FAILURE MODE
// THIS PROJECT KEEPS PAYING FOR — a printed census cannot be wrong, only old, and nothing
// about it invites correction. So the list is generated from `constants.js` and this test
// regenerates it and compares. If someone adds a role and does not re-run it, the audit
// would quietly stop asking about that role and every company would look complete.
// ═════════════════════════════════════════════════════════════════════════════

const sqlPath = path.join(process.cwd(), "supabase/verify/O35_role_audit.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

describe("★★★ the audit's role list matches the app's", () => {
  const canonical = DEFAULT_CHART_OF_ACCOUNTS.filter((a) => a.system_role);

  it("the source of truth is not empty — an empty audit passes everything", () => {
    expect(canonical.length).toBeGreaterThan(40);
  });

  it("★★★ every role in the chart is in the audit, with its code", () => {
    const missing = canonical.filter((a) => !sql.includes(`('${a.system_role}','${a.code}')`));
    expect(missing.map((a) => `${a.system_role}/${a.code}`)).toEqual([]);
  });

  it("★★ and the audit invents none — a role that isn't ours would report false gaps", () => {
    const inSql = [...sql.matchAll(/\('([a-z_]+)','(\d+)'\)/g)].map((m) => `${m[1]}/${m[2]}`);
    const known = new Set(canonical.map((a) => `${a.system_role}/${a.code}`));
    expect(inSql.filter((r) => !known.has(r))).toEqual([]);
  });

  it("★ the counts agree, so neither list can quietly grow past the other", () => {
    const inSql = [...sql.matchAll(/\('([a-z_]+)','(\d+)'\)/g)];
    expect(inSql.length).toBe(canonical.length);
  });
});

describe("★★ it reports and does not repair", () => {
  it("★★★ nothing in the file writes", () => {
    // Setting a role is safe; renumbering a code is NOT — journal lines point at accounts,
    // and moving a code without re-pointing them silently re-files history. The two must
    // never be done by the same script, so this one does neither.
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    for (const verb of [/\bupdate\s+public\./i, /\binsert\s+into/i, /\bdelete\s+from/i, /\balter\s+table/i]) {
      expect([verb.source, verb.test(code)]).toEqual([verb.source, false]);
    }
  });

  it("★★ the foreign-chart accounts are excluded from the SAFE list", () => {
    // O110's 36 came from outside the app in a numbering scheme we don't recognise. Giving
    // them our roles would collide — two accounts claiming `utilities` on one company, with
    // the role index silently keeping whichever it saw last. A booking hazard introduced to
    // tidy a report.
    expect(sql).toMatch(/coalesce\(a\.origin, 'runtime'\) <> 'external'/);
  });

  it("★ and the variant-code list says explicitly that it is not to be acted on", () => {
    expect(sql).toMatch(/REPORTED, NEVER FIXED HERE/);
    expect(sql).toMatch(/silently re-files history/);
  });

  it("★ the safe list distinguishes accounts WITH history from those without", () => {
    // "Set the role" is safe either way, but knowing which accounts carry entries is what
    // tells a person whether a code is load-bearing before anyone proposes touching it.
    expect(sql).toMatch(/count\(l\.id\)\s+as journal_lines/);
    expect(sql).toMatch(/has history — set the role, never renumber/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ★★ THE BACKFILL THE AUDIT PRODUCED — and the limit it does NOT close.
//
// The audit found `opening_balance_equity` missing on seven of eleven companies. `083` adds
// it. But the TEMPLATE path (C254) only runs when someone saves their business profile, and
// the SERVER SEED does not contain 3400 at all — so a new company that never completes that
// step still relies on the create-on-demand door. That is a separate task, and the migration
// says so rather than implying otherwise.
// ═════════════════════════════════════════════════════════════════════════════
describe("★★ 083 — the opening-balance backfill", () => {
  const mig = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/083_opening_balance_equity_backfill.sql"), "utf8");
  const body = mig.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("★★ it is additive only — no rename, renumber, deactivate, or line moved", () => {
    for (const verb of [/\bupdate\s+public\./i, /\bdelete\s+from/i, /\balter\s+table/i, /journal_entry_lines/i]) {
      expect([verb.source, verb.test(body)]).toEqual([verb.source, false]);
    }
  });

  it("★★★ it skips on the ROLE or the CODE, not just one", () => {
    // A company may hold the account under a different number (charts get renumbered — the
    // whole reason the app resolves by role), or hold 3400 under a different name. Either
    // means it has one, and inserting would create a duplicate the role index would then
    // silently pick between.
    expect(body).toMatch(/a\.system_role = 'opening_balance_equity' or a\.code = '3400'/);
  });

  it("★★ and it labels itself `seed`, not the default `runtime`", () => {
    // 070 defaults origin to 'runtime' DELIBERATELY, so an insert that doesn't say where it
    // came from shows up in the O108 detector. A deliberate backfill left unlabelled would
    // arrive as seven accounts the system appears to have invented on its own.
    expect(body).toMatch(/origin\)/);
    expect(body).toMatch(/'seed'/);
  });

  it("★★ every check is SCOPED to what the migration did", () => {
    // ★★★ VERIFY (c) SHIPPED UNSCOPED AND RETURNED A FALSE FAIL ON THE LIVE RUN. It asked
    // whether EVERY opening-balance account is labelled `seed`, but pre-existing ones carry
    // whatever origin they were created with — and one is `runtime` BY A RECORDED DECISION
    // (073 left Franklin Ave's deliberately, because origin records how a row got here).
    // VERIFY (b) two lines above scopes to rows this migration created; (c) did not. Two
    // checks in one file, one scoped right and one not, and the unscoped one failed correct
    // data. A false FAIL on a correct migration is the mirror of a false PASS on a broken one.
    const checks = mig.slice(mig.indexOf("VERIFY (a)"));
    const originCheck = checks.slice(checks.indexOf("VERIFY (c)"), checks.indexOf("VERIFY (d)"));
    expect(originCheck).toMatch(/created_at > now\(\) - interval/);
    expect(originCheck).not.toMatch(/where system_role = 'opening_balance_equity';/);
  });

  it("★★ the verification checks for DUPLICATES, not just presence", () => {
    // "At least one" is not the check: a duplicate is the failure this insert could
    // plausibly cause, and byRole would resolve to whichever it read last.
    expect(mig).toMatch(/min\(n\) = 1 and max\(n\) = 1/);
  });

  it("★★★ and it states the limit it does NOT close", () => {
    // The seed function still lacks 3400, so a company that never saves a business profile
    // relies on the on-demand path. Editing that function requires starting from
    // pg_get_functiondef (§6) — its own task, and bundling it here is how 063 nearly
    // dropped 17 accounts.
    expect(mig).toMatch(/DOES NOT TOUCH `seed_company_accounts`/);
    expect(mig).toMatch(/Recorded as still open rather than quietly bundled/);
  });
});
