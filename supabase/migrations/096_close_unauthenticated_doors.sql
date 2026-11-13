-- ═══════════════════════════════════════════════════════════════════════════════
-- 096 — CLOSE THREE DOORS THAT WERE OPEN TO PEOPLE WHO SHOULD NOT HAVE THEM.
-- Found 2026-11-12 by a whole-code review; two were confirmed against LIVE with the public
-- key before this was written (see docs/notes/MIGRATIONS.md once applied).
--
-- (1) A MEMBERSHIP ROW COULD BE MOVED TO ANOTHER COMPANY BY ITS OWN USER.
--     `company_users_update` lets a user update their own row (`user_id = auth.uid()`), and
--     081's trigger looks only at `role`. So anyone who signed up and created a company
--     (role `owner`) could set that row's `company_id` to another company's id and arrive
--     as ITS owner. A membership never moves: it is removed, and a new one comes from an
--     invite. The guard has no exemption for any caller.
--
-- (2) PRIVILEGED FUNCTIONS WERE CALLABLE WITHOUT SIGNING IN.
--     Their guard is `if not public.is_platform_admin() then raise`. For a caller with no
--     session that function returns NULL (not false), `not NULL` is NULL, and plpgsql does
--     not raise on NULL — so the body ran. EXECUTE is granted to `anon` by default.
--     This takes EXECUTE away from `public` and `anon` on every SECURITY DEFINER function
--     in `public` EXCEPT the ones a signed-out visitor legitimately reaches:
--       · `invite_details` (the invite banner on the sign-in page), and
--       · any function a row-security policy calls (evaluated as the caller, so `anon`
--         must be able to run it to get "no rows" rather than an error).
--     ★ IT CHANGES NOTHING FOR `authenticated` OR `service_role`: each function's access
--       for those two is read BEFORE the revoke and granted back explicitly if it was there
--       (revoking PUBLIC would otherwise take it with it). Functions deliberately closed to
--       `authenticated` (075, 086) stay closed.
--
-- (3) TWO OLD VIEWS RAN AS THEIR OWNER, PAST ROW SECURITY.
--     `trial_balance` and `ar_aging` (baseline; the app reads neither) returned every
--     company's rows to any caller. Every view in `public` that is not already
--     `security_invoker` becomes so — it then sees exactly what its caller may see — and
--     `anon` loses its grant on it.
--
-- Standalone: creates one new function + trigger; replaces NO existing function body.
-- Idempotent. VERIFY: supabase/verify/096_doors.sql (run (A0) and (C0) BEFORE applying).
-- ROLLBACK (1): drop trigger guard_company_user_identity on public.company_users;
--               drop function public.guard_company_user_identity();
-- ═══════════════════════════════════════════════════════════════════════════════
begin;

-- ── (1) a membership row never changes company or person ─────────────────────
create or replace function public.guard_company_user_identity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if NEW.company_id is distinct from OLD.company_id or NEW.user_id is distinct from OLD.user_id then
    raise exception 'A team membership cannot be moved to another company or another person. Remove it and send a new invite instead.'
      using errcode = 'insufficient_privilege';
  end if;
  return NEW;
end $$;

revoke all on function public.guard_company_user_identity() from public, anon, authenticated;

drop trigger if exists guard_company_user_identity on public.company_users;
create trigger guard_company_user_identity
  before update of company_id, user_id on public.company_users
  for each row execute function public.guard_company_user_identity();

-- ── (2) no privileged function for a caller who has not signed in ────────────
do $$
declare
  f record;
  had_auth boolean;
  had_service boolean;
begin
  for f in
    select p.oid, p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.prokind = 'f'
      and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
      and p.proname <> 'invite_details'
      -- anything a row-security policy calls stays runnable by the caller it is evaluated as
      and not exists (
        select 1 from pg_policy pol
        where (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
               coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) ~ ('\m' || p.proname || '\(')
      )
  loop
    had_auth    := has_function_privilege('authenticated', f.oid, 'EXECUTE');
    had_service := has_function_privilege('service_role',  f.oid, 'EXECUTE');
    execute format('revoke execute on function %s from public', f.sig);
    execute format('revoke execute on function %s from anon', f.sig);
    if had_auth    then execute format('grant execute on function %s to authenticated', f.sig); end if;
    if had_service then execute format('grant execute on function %s to service_role',  f.sig); end if;
  end loop;
end $$;

-- ── (3) every view sees only what its caller may see ─────────────────────────
do $$
declare v record;
begin
  for v in
    select c.oid::regclass::text as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and not (coalesce(c.reloptions, '{}'::text[]) && array['security_invoker=true', 'security_invoker=on', 'security_invoker=1'])
  loop
    execute format('alter view %s set (security_invoker = true)', v.name);
    execute format('revoke all on %s from anon', v.name);
  end loop;
end $$;

commit;
