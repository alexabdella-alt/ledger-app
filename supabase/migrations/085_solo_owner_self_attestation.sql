-- 085 — A SOLO OWNER MAY SIGN OFF THEIR OWN BOOKS, AND THE ROW MUST SAY THAT IS WHAT HAPPENED.
--
-- ── THE DECISION ──────────────────────────────────────────────────────────────
-- Operator's call, 2026-08-30: *let a solo owner sign with an acknowledgement.*
--
-- ── WHY A MIGRATION AND NOT A CHECKBOX ────────────────────────────────────────
-- `053` gated `period_signoffs` writes on `is_company_reviewer` = admin OR accountant,
-- deliberately EXCLUDING the plain owner — and the database means it. We watched it refuse
-- an owner this morning (`supabase/verify/nonreviewer_rls_probes.sql` probe 1). So shipping
-- the acknowledgement in the UI alone would rebuild the team-invites failure exactly: the
-- whole flow present and the last step impossible.
--
-- ★★ AND IT DOES NOT PROMOTE ANYONE. `053` step 3 met this same case once, by setting
-- `role = 'admin'` on the owner of any company that had no reviewer. That was right for a
-- one-time backfill and is the wrong shape now, for two reasons: it is PERMANENT, so a
-- company that later hires an accountant never gets the separation back; and since `081`
-- nobody can change their own role, so it cannot be undone by the person it was done to.
-- **This grants the ACTION, evaluated at write time, so it stops applying by itself the
-- moment a real reviewer joins.** Nothing about the person changes.
--
-- ★ THE SEAT IS NOT GRANTED EITHER — that is a client-side matter and is stated here because
-- it is the same decision: `nav.js` derives the CPA cockpit from `canAttestPeriod`, so making
-- an owner a reviewer would drop a client into the reviewer's workbench, which is the exact
-- IA the product is trying to keep them out of. They get the sign-off action, not the seat.
--
-- ── THE FLAG CANNOT LIE ───────────────────────────────────────────────────────
-- ★★★ `self_attested` is not a hint the client sets — the POLICY decides which path a row
-- was allowed through, using a CASE:
--   · a row marked `self_attested` is accepted ONLY from a solo owner;
--   · a row NOT marked is accepted ONLY from a reviewer.
-- So the column is a property of how the write was actually permitted, not a description
-- written alongside it. That is §9's describe-from-the-record rule enforced by the database:
-- a client cannot record an accountant's review when an owner signed, or the reverse.
--
-- ▶ THE POINT OF STORING IT AT ALL: the whole value of a sign-off is WHO STOOD BEHIND IT.
-- "Reviewed and signed off" and "you signed this yourself, nobody else has looked" are
-- different facts, and a books history that cannot tell them apart is worth less than one
-- that admits which it was.
--
-- Idempotent. Wrapped in a transaction. No backfill: every existing row was written under
-- the reviewer-only policy, so `false` is the correct and true value for all of them.

begin;

-- ── (1) The record of what kind of attestation this was ───────────────────────
alter table public.period_signoffs
  add column if not exists self_attested boolean not null default false;

comment on column public.period_signoffs.self_attested is
  'True when the company OWNER signed their own books because the company has no admin/accountant. Enforced by the insert/update policies, not set freely by the client.';

-- ── (2) Does this company have anyone who could review? ───────────────────────
-- SECURITY DEFINER for the same reason as every other predicate here: it reads
-- `company_users`, which carries RLS, and a gate whose input a policy can hide is a gate
-- that can be defeated by not being able to see the thing it checks.
--
-- ★ NOTE IT DOES NOT CONSULT `auth.uid()` — this is a fact about the COMPANY, not about the
-- caller, and keeping those separate is what lets the owner test below stay readable.
create or replace function public.company_has_reviewer(cid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.company_users cu
    where cu.company_id = cid
      and cu.accepted_at is not null
      and cu.role in ('admin', 'accountant')
  );
$$;

revoke all on function public.company_has_reviewer(uuid) from public;
grant execute on function public.company_has_reviewer(uuid) to authenticated, service_role;

-- ── (3) Am I the owner of a company that has nobody else who can sign? ────────
-- ★ AN UNACCEPTED INVITE IS NOT A PERSON. `accepted_at is not null` on both sides: a company
-- whose accountant has been invited but has never clicked the link still has nobody who can
-- sign, and blocking the owner on the strength of an unanswered email would leave them in
-- exactly the dead end this migration exists to end.
create or replace function public.is_company_solo_owner(cid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
           select 1 from public.company_users cu
           where cu.company_id = cid
             and cu.user_id = auth.uid()
             and cu.accepted_at is not null
             and cu.role = 'owner'
         )
     and not public.company_has_reviewer(cid);
$$;

revoke all on function public.is_company_solo_owner(uuid) from public;
grant execute on function public.is_company_solo_owner(uuid) to authenticated, service_role;

-- ── (4) The gate, widened by exactly one case ─────────────────────────────────
-- ★★ THE `CASE` IS WHAT MAKES THE COLUMN TRUSTWORTHY. Without it a reviewer could write
-- `self_attested = true` (understating their own review) or, far worse, an owner could write
-- `false` and the books would record an accountant's review that never happened.
drop policy if exists period_signoffs_insert on public.period_signoffs;
create policy period_signoffs_insert on public.period_signoffs
  for insert to authenticated
  with check (
    signed_by = auth.uid()
    and case
          when self_attested then public.is_company_solo_owner(company_id)
          else public.is_company_reviewer(company_id)
        end
  );

-- UPDATE covers re-signing (the app upserts) AND soft-revoke. Same discrimination.
-- `using` decides which rows you may touch; `with check` decides what they may become.
--
-- ★ A SOLO OWNER MAY REVOKE THEIR OWN SIGN-OFF. Being able to sign and not to unsign would
-- be a one-way door on the one surface where changing your mind is legitimate — and `078`
-- makes a signed month refuse corrections, so an owner who could not reopen it would be
-- locked out of their own books by their own click.
drop policy if exists period_signoffs_update on public.period_signoffs;
create policy period_signoffs_update on public.period_signoffs
  for update to authenticated
  using (public.is_company_reviewer(company_id) or public.is_company_solo_owner(company_id))
  with check (
    case
      when self_attested then public.is_company_solo_owner(company_id)
      else public.is_company_reviewer(company_id)
    end
  );

commit;


-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFY — ONE STANDALONE STATEMENT PER CHECK. Run them ONE AT A TIME (§6): the editor
-- shows only the LAST statement's result, so a pasted block hides every verdict but one.
--
-- ▶ (c)–(e) borrow another member's identity and report through `raise exception`, which
-- Supabase prints in RED under "Failed to run sql query". `P0001` means a function raised it
-- deliberately. The message LEADS with that — read it, it is the result.
--
-- ▶▶ THE ROLE SWITCH IS LOAD-BEARING. The SQL editor runs as a SUPERUSER, which BYPASSES
-- RLS — a probe that skips `set_config('role','authenticated')` tests nothing and reports a
-- confident PASS while doing so.
-- ═══════════════════════════════════════════════════════════════════════════════

-- VERIFY (a) — the column exists, defaults false, and no existing row claims otherwise.
--
-- select
--   count(*) filter (where self_attested) as already_flagged,
--   count(*)                              as total,
--   case when count(*) filter (where self_attested) = 0
--        then 'PASS - column present; no historical row claims self-attestation (all were reviewer-written)'
--        else 'FAIL - ' || count(*) filter (where self_attested) || ' pre-existing row(s) marked self_attested'
--   end as verdict
-- from public.period_signoffs;


-- VERIFY (b) — both predicates installed and answering.
--
-- select
--   case when count(*) = 2 then 'PASS - company_has_reviewer and is_company_solo_owner both present'
--        else 'FAIL - only ' || count(*) || ' of 2 predicates exist'
--   end as verdict
-- from pg_proc
-- where proname in ('company_has_reviewer', 'is_company_solo_owner');


-- VERIFY (c) — ★★ THE POINT OF THE WHOLE MIGRATION: a solo owner CAN now sign, with the flag.
-- Borrows a real owner of a company that has no admin/accountant. Rolled back.
--
-- do $$
-- declare v text; u uuid; c uuid;
-- begin
--   select cu.user_id, cu.company_id into u, c
--   from public.company_users cu
--   where cu.role = 'owner' and cu.accepted_at is not null
--     and not public.company_has_reviewer(cu.company_id)
--   limit 1;
--   if u is null then
--     raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no solo-owner company exists to test with';
--   end if;
--   perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
--   perform set_config('role', 'authenticated', true);
--   begin
--     insert into public.period_signoffs (company_id, period, signed_by, self_attested)
--     values (c, '1999-01', u, true);
--     v := 'PASS - a solo owner signed their own books, with self_attested recorded';
--   exception
--     when insufficient_privilege then v := 'FAIL - still refused: ' || SQLERRM;
--     when others then v := 'INCONCLUSIVE - failed for another reason: ' || SQLERRM;
--   end;
--   raise exception 'CHECK RESULT (not an error — this rolled back on purpose): % [ran as: %]', v, current_setting('role', true);
-- end $$;


-- VERIFY (d) — ★★★ THE FLAG CANNOT LIE: the SAME owner may NOT write self_attested = false.
-- Without this, (c) passing is equally consistent with "we let owners record an accountant's
-- review that never happened".
--
-- do $$
-- declare v text; u uuid; c uuid;
-- begin
--   select cu.user_id, cu.company_id into u, c
--   from public.company_users cu
--   where cu.role = 'owner' and cu.accepted_at is not null
--     and not public.company_has_reviewer(cu.company_id)
--   limit 1;
--   if u is null then
--     raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no solo-owner company exists to test with';
--   end if;
--   perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
--   perform set_config('role', 'authenticated', true);
--   begin
--     insert into public.period_signoffs (company_id, period, signed_by, self_attested)
--     values (c, '1999-02', u, false);
--     v := 'FAIL - an owner recorded a sign-off as a REVIEWER review; the flag can lie';
--   exception
--     when insufficient_privilege then v := 'PASS - refused: an owner cannot record their sign-off as a reviewer''s';
--     when others then v := 'INCONCLUSIVE - failed for another reason: ' || SQLERRM;
--   end;
--   raise exception 'CHECK RESULT (not an error — this rolled back on purpose): % [ran as: %]', v, current_setting('role', true);
-- end $$;


-- VERIFY (e) — ★★ AND THE SEPARATION STILL HOLDS WHERE IT MATTERS: an owner of a company that
-- HAS an accountant is still refused. This is the "did it block too much / too little?" check
-- in the direction that would quietly destroy the product's whole point.
--
-- do $$
-- declare v text; u uuid; c uuid;
-- begin
--   select cu.user_id, cu.company_id into u, c
--   from public.company_users cu
--   where cu.role = 'owner' and cu.accepted_at is not null
--     and public.company_has_reviewer(cu.company_id)
--   limit 1;
--   if u is null then
--     raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no company with BOTH an owner and a reviewer exists to test with';
--   end if;
--   perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
--   perform set_config('role', 'authenticated', true);
--   begin
--     insert into public.period_signoffs (company_id, period, signed_by, self_attested)
--     values (c, '1999-03', u, true);
--     v := 'FAIL - an owner self-attested even though this company HAS an accountant';
--   exception
--     when insufficient_privilege then v := 'PASS - refused: the separation still holds where a reviewer exists';
--     when others then v := 'INCONCLUSIVE - failed for another reason: ' || SQLERRM;
--   end;
--   raise exception 'CHECK RESULT (not an error — this rolled back on purpose): % [ran as: %]', v, current_setting('role', true);
-- end $$;
