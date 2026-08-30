import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ═════════════════════════════════════════════════════════════════════════════
// ★★ THE MEMBERSHIP TABLE HANDED OUT ADMIN. Found while checking whether a LEDGER ITEM was
// stale (`O93` — "the client-owner must not sign off their own books"), not while looking
// for a security bug. The item described the OLD gate; `053` had already replaced it, and a
// live probe confirmed an owner IS refused on `period_signoffs`. Reading how that could be
// worked around is what surfaced this.
//
// `001` gave `company_users` the four standard policies, each carrying `user_id =
// auth.uid()` beside the admin test — intended for accepting an invite. Unscoped, it says:
//   · UPDATE — a viewer may set their own role to admin; an owner may make themselves a
//     reviewer and sign off their own books (the exact thing O93 exists to prevent)
//   · INSERT — `company_id` is unconstrained, so a user may insert a membership into ANY
//     company and `is_company_member` asks for precisely that row
//
// ★ NEITHER CLAUSE IS USED. Every membership write goes through a SECURITY DEFINER function
// (`create_company`, `accept_invite`); `src/` only ever SELECTs this table.
// ═════════════════════════════════════════════════════════════════════════════

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const strip = (t) => t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("★★ nothing in the client writes company_users", () => {
  it("the app only reads it — so tightening the policies removes an unused ability", () => {
    // This is the load-bearing fact behind the fix: if the client wrote memberships, an
    // admin-only INSERT policy would break signup. It does not.
    const files = [];
    const walk = (d) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, f.name);
        if (f.isDirectory()) walk(full);
        else if (/\.(js|jsx)$/.test(f.name)) files.push(full);
      }
    };
    walk(path.join(process.cwd(), "src"));
    const writes = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      // `.from("company_users")` followed by a mutating verb before the next `.from(`
      const re = /from\("company_users"\)([\s\S]{0,200})/g;
      let m;
      while ((m = re.exec(src))) {
        if (/\.(insert|update|upsert|delete)\(/.test(m[1])) writes.push(`${path.relative(process.cwd(), f)}`);
      }
    }
    expect(writes).toEqual([]);
  });
});

describe("★★ 081 closes self-escalation without blocking ordinary work", () => {
  const mig = read("supabase/migrations/081_company_users_no_self_escalation.sql");
  const body = strip(mig);

  it("INSERT is admin-only — the unscoped self-insert clause is gone", () => {
    // ★ END ANCHOR SEARCHED FROM THE START OFFSET, and off a marker that survives comment
    // stripping — `-- ── (2)` is a COMMENT and `body` has comments removed, so indexOf
    // returned -1 and the slice ran to the end of the file, picking up `user_id =
    // auth.uid()` from the trigger. Third anchor slip today; the rule is the same each time.
    const insStart = body.indexOf("create policy company_users_insert");
    const ins = body.slice(insStart, body.indexOf("create or replace function", insStart));
    expect(ins).toMatch(/with check \(public\.is_company_admin\(company_id\)\)/);
    expect(ins).not.toMatch(/user_id = auth\.uid\(\)/);
  });

  it("★ the role guard is a TRIGGER, because RLS cannot see the OLD row", () => {
    // A policy can say "the new role is admin"; only a trigger can say "the role CHANGED".
    // Blocking self-update outright would be the 079 mistake — refusing more than we mean.
    expect(body).toMatch(/create trigger guard_company_user_role\s+before update on public\.company_users/);
    expect(body).toMatch(/NEW\.role is not distinct from OLD\.role/);
  });

  it("★★ nobody changes their OWN role — not even an owner or admin (O93)", () => {
    // An owner who can promote themselves to admin becomes a reviewer, and can then attest
    // to their own books. Separation of duties: manage others' roles, not your own.
    const fn = body.slice(body.indexOf("create or replace function public.guard_company_user_role"));
    const selfTest = fn.indexOf("NEW.user_id = auth.uid()");
    const adminTest = fn.indexOf("not public.is_company_admin");
    expect(selfTest).toBeGreaterThan(-1);
    expect(adminTest).toBeGreaterThan(-1);
    expect(selfTest).toBeLessThan(adminTest);   // the self test is unconditional, ahead of the admin allowance
  });

  it("★ a migration or service-role write is exempt — 053 rewrites roles in bulk", () => {
    const fn = body.slice(body.indexOf("create or replace function public.guard_company_user_role"));
    expect(fn).toMatch(/if auth\.uid\(\) is null then return NEW; end if;/);
  });

  it("the refusals are plain language and name the way out", () => {
    expect(mig).toMatch(/Ask another admin on this company to do it\./);
    expect(mig).toMatch(/Only an owner or admin can change a team member/);
  });
});

describe("★★ the probe demonstrates the hole before it claims one", () => {
  const probe = read("supabase/verify/081_self_escalation.sql");

  it("★ (A) and (B) are expected to FAIL before the migration — that IS the evidence", () => {
    expect(probe).toMatch(/BEFORE 081: expect FAIL/);
    expect(probe).toMatch(/this is the hole 081 closes/);
  });

  it("★★ (B) states the CONSEQUENCE, not the mechanism", () => {
    // "inserted a row" is a fact about a table. "can now read N of its journal entries" is
    // the thing that is actually wrong, and it is counted rather than asserted.
    expect(probe).toMatch(/can now read ' \|\| seen \|\| ' of its journal entries/);
    expect(probe).toMatch(/select count\(\*\) into seen from public\.journal_entries where company_id = target/);
  });

  it("★ (C) checks the 079 direction — that the fix did not block ordinary work", () => {
    expect(probe).toMatch(/an admin can still change someone else/);
    expect(probe).toMatch(/FAIL - 081 blocked an ordinary role change/);
  });

  it("every block reports the role it ran as, and counts rows rather than trusting silence", () => {
    // ★ RELATIONAL, NOT A MAGIC NUMBER. The first version hard-coded "3 blocks", and went
    // red the moment a fourth probe was added — a test that has to be edited whenever the
    // thing it guards grows is a test that will eventually be edited to agree with a
    // mistake. Tie it to the block count instead: EVERY block reports its role.
    const blocks = (probe.match(/^do \$\$/gm) || []).length;
    expect(blocks).toBeGreaterThanOrEqual(4);
    expect((probe.match(/\[ran as: %\]/g) || []).length).toBe(blocks);
    // ★★ EVERY ROW COUNT IS DECIDED ON — but NOT all the same way, and my first assertion
    // flattened that. A probe testing a REFUSAL treats zero rows as PASS (the write did not
    // happen, which is the point). A probe testing a CAPABILITY must treat zero rows as
    // INCONCLUSIVE (nothing was exercised). Requiring one arm everywhere would have forced
    // the wrong verdict onto half the file. What must hold universally is only that the
    // count is never ignored.
    const parts = probe.split("get diagnostics n = row_count;").slice(1);
    expect(parts.length).toBeGreaterThanOrEqual(3);
    for (const after of parts) expect(after.slice(0, 260)).toMatch(/if n = 1 then/);
    // An unexpected error is never counted as a pass — the 076 rule. Every block that
    // catches a refusal must also have an "it failed for another reason" arm.
    const passOnRefusal = (probe.match(/when insufficient_privilege then/g) || []).length;
    expect((probe.match(/INCONCLUSIVE - failed for another reason/g) || []).length).toBe(passOnRefusal);
  });
});
