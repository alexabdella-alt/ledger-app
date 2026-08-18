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

  it("★ all FIVE call sites of buildAccountInsert in App.jsx log an audit event", () => {
    // If a fifth site appears without an audit line, this fails — which is the point.
    const sites = [...app.matchAll(/buildAccountInsert\(/g)].map((m) => m.index);
    expect(sites.length, "call sites of buildAccountInsert in App.jsx").toBe(5);
    for (const i of sites) {
      const window = app.slice(i, i + 900);
      expect(window, `site at offset ${i} has no account_materialized audit within 900 chars`)
        .toMatch(/logAudit\("account_materialized"/);
    }
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
