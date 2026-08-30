-- 076 — TEAM INVITES: MAKE THE INVITE'S ROLE VOCABULARY MATCH THE MEMBERSHIP TABLE'S.
--
-- ▶ HOLD — NOT APPLIED. Written 2026-08-29 alongside C225. Apply and verify in the same
-- task (§6), with the verification output in the report.
--
-- ── THE DEFECT ────────────────────────────────────────────────────────────────
-- `company_users_role_check` allows exactly: owner | admin | accountant | viewer.
-- `company_invites.role` defaults to 'member' (027) and carried no constraint at all, and
-- the invite form offered "Member" as its DEFAULT option. `accept_invite` inserts the
-- invite's role straight into `company_users`, so **an invite created with the default
-- role could never be accepted** — it hit the check constraint at the moment the person
-- clicked the link. The whole flow was built and the last step could not complete.
--
-- C225 fixed the CLIENT so no new invite can carry a rejected role. This fixes the two
-- things only the database can:
--   (a) the column DEFAULT, so an insert that omits the role is still acceptable;
--   (b) any PENDING invite already sitting there with an unacceptable role.
--
-- ★ AND IT ADDS THE CONSTRAINT THAT WOULD HAVE MADE THIS IMPOSSIBLE. The mismatch survived
-- because `company_invites.role` was free text — the two tables described the same concept
-- and only one of them enforced it. A check here means a future divergence fails at the
-- INSERT, in the invite screen, in front of the person creating it, rather than silently
-- days later in front of the person trying to accept.
--
-- Idempotent. Wrapped in a transaction.

begin;

-- (a) The default becomes the least-privileged role that actually exists.
alter table public.company_invites alter column role set default 'viewer';

-- (b) Existing pending invites that can never be accepted. 'member' was the only value the
-- old UI could produce besides 'admin', and it maps to 'viewer' — same intent, real name.
-- Scoped to PENDING: an accepted or revoked invite is history and is not rewritten.
update public.company_invites
   set role = 'viewer'
 where status = 'pending'
   and role not in ('admin', 'accountant', 'viewer');

-- (c) The constraint that keeps the two vocabularies in step. 'owner' is deliberately NOT
-- invitable — a company has exactly one and it is created with the company.
alter table public.company_invites drop constraint if exists company_invites_role_check;
alter table public.company_invites
  add constraint company_invites_role_check
  check (role in ('admin', 'accountant', 'viewer'));

commit;


-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFY — ONE STANDALONE STATEMENT PER CHECK, EACH RETURNING A SINGLE VERDICT ROW.
-- Run them ONE AT A TIME: the Supabase SQL editor shows only the LAST statement's result,
-- so pasting a block hides every verdict but the final one — silently, and in the
-- direction of looking fine (§6).
-- ═══════════════════════════════════════════════════════════════════════════════

-- VERIFY (a) — the default is now a role the membership table accepts.
--
-- select
--   column_default,
--   case when column_default like '%viewer%'
--        then 'PASS - default is viewer'
--        else 'FAIL - default is ' || coalesce(column_default, 'null')
--   end as verdict
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'company_invites' and column_name = 'role';


-- VERIFY (b) — no pending invite can still be rejected on acceptance.
--
-- select
--   count(*) as unacceptable_pending,
--   case when count(*) = 0
--        then 'PASS - every pending invite carries a role company_users accepts'
--        else 'FAIL - ' || count(*) || ' pending invite(s) would be rejected on acceptance'
--   end as verdict
-- from public.company_invites
-- where status = 'pending' and role not in ('admin', 'accountant', 'viewer');


-- VERIFY (c) — the constraint EXISTS **and REFUSES something**.
--
-- ★ A constraint nobody has watched reject anything is a constraint on paper — the
-- standard `071` was held to. This makes it refuse, inside a transaction that rolls back,
-- so nothing is left behind. Run the whole block as ONE statement; the rollback is what
-- makes it safe, and a loose statement pasted alone would commit.
--
-- do $$
-- declare ok boolean := false;
-- begin
--   begin
--     insert into public.company_invites (company_id, email, role, invited_by)
--     values ((select id from public.companies limit 1), 'verify-076@example.invalid', 'member',
--             (select user_id from public.company_users limit 1));
--   exception when check_violation then ok := true;
--   end;
--   raise exception 'VERDICT: %', case when ok
--     then 'PASS - the constraint refused role=member'
--     else 'FAIL - role=member was ACCEPTED; the constraint is not doing its job' end;
-- end $$;
--
-- ▶ The `raise exception` is deliberate: it aborts the transaction (so the test row is
-- never committed) AND surfaces the verdict, which `raise notice` does not reliably do in
-- the Supabase editor (§6). Expect to see the VERDICT text as an error — read it, that IS
-- the result.
