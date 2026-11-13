-- ═══════════════════════════════════════════════════════════════════════════════
-- 096 / 097 — DEMONSTRATE EACH DOOR, THEN PROVE IT IS SHUT. Run each block ON ITS OWN;
-- each returns ONE verdict.
--
-- ★ RUN (A), (C) AND (D) BEFORE APPLYING 096. Each is expected to say FAIL — that is the
--   evidence the migration is needed. After applying, (A) (C) (D) must flip to PASS, and
--   (B) (D2) (F) must PASS — those three are the "it blocks too much" direction, the ones
--   a tired verification skips. (E) is for 097.
-- (D) and (D2) end in a deliberate exception so nothing they try survives; the verdict is
--   in the message, and it says which role it ran as.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── (A) CAN SOMEONE WHO IS NOT SIGNED IN RUN A PRIVILEGED FUNCTION? (read-only) ──
-- BEFORE 096: expect FAIL. AFTER: expect PASS.
select case when count(*) = 0
  then 'PASS - no privileged function is runnable without signing in (apart from the invite lookup and the row-security checks)'
  else 'FAIL - ' || count(*) || ' privileged functions are runnable without signing in: ' || string_agg(p.proname, ', ' order by p.proname)
end as verdict
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
  and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
  and p.proname <> 'invite_details'
  and not exists (
    select 1 from pg_policy pol
    where (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
           coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) ~ ('\m' || p.proname || '\(')
  )
  and has_function_privilege('anon', p.oid, 'EXECUTE');

-- ── (B) AND A SIGNED-IN USER CAN STILL RUN EVERYTHING THE APP CALLS (read-only) ──
-- Expect PASS before AND after. If this says FAIL after 096, the app is broken: tell me.
select case when count(*) filter (where not ok) = 0
  then 'PASS - all ' || count(*) || ' functions the app calls are still runnable by a signed-in user'
  else 'FAIL - a signed-in user can no longer run: ' || string_agg(name, ', ') filter (where not ok)
end as verdict
from (
  select want.name,
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = want.name
                   and has_function_privilege('authenticated', p.oid, 'EXECUTE')) as ok
  from unnest(array[
    'accept_invite','create_company','invite_details','list_company_members','post_journal_entry',
    'restore_deleted_entry','security_check','seed_company_accounts',
    'get_admin_company_stats','get_admin_duplicate_entries','get_admin_failed_uploads',
    'get_admin_orphaned_documents','get_admin_platform_stats','get_admin_recent_errors',
    'get_admin_search_entries','get_admin_stuck_uploads','get_admin_table_counts',
    'get_admin_trace_file','get_admin_visibility_failures'
  ]) as want(name)
) t;

-- ── (C) DOES ANY VIEW RUN AS ITS OWNER, PAST ROW SECURITY? (read-only) ───────
-- BEFORE 096: expect FAIL. AFTER: expect PASS.
select case when count(*) = 0
  then 'PASS - every view in public shows a caller only what that caller may see'
  else 'FAIL - ' || count(*) || ' views bypass row security: ' || string_agg(c.relname, ', ' order by c.relname)
end as verdict
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
  and not (coalesce(c.reloptions, '{}'::text[]) && array['security_invoker=true', 'security_invoker=on', 'security_invoker=1']);

-- ── (D) CAN A USER MOVE THEIR OWN MEMBERSHIP INTO ANOTHER COMPANY? ───────────
-- BEFORE 096: expect FAIL. AFTER: expect PASS (refused). Rolls back either way.
do $$
declare v text; who text; n int; u uuid; c uuid; other uuid;
begin
  select cu.user_id, cu.company_id into u, c
  from public.company_users cu
  join auth.users au on au.id = cu.user_id
  where cu.accepted_at is not null and lower(au.email) <> 'alexabdella@gmail.com'
  limit 1;
  if u is null then
    raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no non-platform-admin member exists to act as';
  end if;
  select co.id into other from public.companies co
  where co.id <> c and not exists (select 1 from public.company_users x where x.company_id = co.id and x.user_id = u)
  limit 1;
  if other is null then
    raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no second company to try to move into';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  who := current_user;

  begin
    update public.company_users set company_id = other where user_id = u and company_id = c;
    get diagnostics n = row_count;
    if n = 1 then
      v := 'FAIL - a user moved their own membership into a company they do not belong to (this is the door 096 closes)';
    else
      v := 'PASS - the move matched no rows';
    end if;
  exception
    when insufficient_privilege then v := 'PASS - refused: ' || SQLERRM;
    when others then v := 'INCONCLUSIVE - failed for another reason: ' || SQLERRM;
  end;

  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): % [ran as: %]', v, who;
end $$;

-- ── (D2) AND AN ORDINARY EDIT TO YOUR OWN MEMBERSHIP STILL SAVES ─────────────
-- Expect PASS after 096. If FAIL, the guard blocks too much and must not stay.
do $$
declare v text; who text; n int; u uuid; c uuid;
begin
  select cu.user_id, cu.company_id into u, c
  from public.company_users cu
  join auth.users au on au.id = cu.user_id
  where cu.accepted_at is not null and lower(au.email) <> 'alexabdella@gmail.com'
  limit 1;
  if u is null then
    raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no non-platform-admin member exists to act as';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  who := current_user;

  begin
    update public.company_users set accepted_at = accepted_at, company_id = company_id where user_id = u and company_id = c;
    get diagnostics n = row_count;
    v := case when n = 1 then 'PASS - an edit that leaves the company and the person unchanged still saves'
              else 'INCONCLUSIVE - the edit matched ' || n || ' rows' end;
  exception
    when others then v := 'FAIL - an ordinary edit was refused: ' || SQLERRM;
  end;

  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): % [ran as: %]', v, who;
end $$;

-- ── (E) is_platform_admin() ANSWERS false, NEVER "UNKNOWN" (read-only; for 097) ──
-- The SQL editor has no signed-in user, which is exactly the case that used to return NULL.
-- BEFORE 097: expect FAIL. AFTER: expect PASS.
select case when public.is_platform_admin() is null
  then 'FAIL - with nobody signed in, is_platform_admin() answers UNKNOWN (NULL), which the guards read as "let through"'
  when public.is_platform_admin() = false
  then 'PASS - with nobody signed in, is_platform_admin() answers false'
  else 'INCONCLUSIVE - it answered true here; run this from the SQL editor, not as a signed-in user'
end as verdict;

-- ── (F) THE SIGN-IN PAGE'S INVITE LOOKUP STILL WORKS FOR A SIGNED-OUT VISITOR (read-only) ──
-- Expect PASS before and after.
select case
  when not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'invite_details' and has_function_privilege('anon', p.oid, 'EXECUTE'))
    then 'FAIL - a signed-out visitor can no longer look up an invite (the banner on the sign-in page would break)'
  when not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'is_company_member' and has_function_privilege('anon', p.oid, 'EXECUTE'))
    then 'FAIL - the row-security check is no longer runnable by a signed-out caller (their queries would error instead of returning nothing)'
  else 'PASS - the invite lookup and the row-security checks are still reachable where they must be'
end as verdict;
