-- VERIFY 102 — one statement per check; paste each on its own. Before 102: (A) and (B) FAIL; after: PASS.

-- (A) nobody signed in can write a company's plan (Postgres's own privilege resolver)
select case
  when has_table_privilege('authenticated', 'public.subscriptions', 'INSERT')
    or has_table_privilege('authenticated', 'public.subscriptions', 'UPDATE')
    or has_table_privilege('authenticated', 'public.subscriptions', 'DELETE')
  then 'FAIL - authenticated can still insert/update/delete subscriptions'
  else 'PASS - authenticated cannot insert, update or delete subscriptions'
end as verdict;

-- (B) no write policy is left on the table; the read policy stays
select case
  when exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'subscriptions' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL'))
  then 'FAIL - a write policy remains: ' || (select string_agg(policyname || ' (' || cmd || ')', ', ') from pg_policies where schemaname = 'public' and tablename = 'subscriptions' and cmd in ('INSERT','UPDATE','DELETE','ALL'))
  when not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'subscriptions' and cmd = 'SELECT')
  then 'FAIL - the read policy is gone (the Plan & billing page could not load)'
  else 'PASS - read policy only'
end as verdict;

-- (C) a new company still gets its trial — a rolled-back probe. One block; the red "ERROR: P0001" is the verdict, not a failure.
do $$
declare v_id uuid; v_n int;
begin
  insert into public.companies (name) values ('verify-102-probe') returning id into v_id;
  select count(*) into v_n from public.subscriptions where company_id = v_id and status = 'trialing' and trial_ends_at > now() + interval '13 days';
  raise exception 'CHECK RESULT (not an error — this rolled back on purpose): %',
    case when v_n = 1 then 'PASS - a new company gets exactly one 14-day trial row' else 'FAIL - trial rows for the new company: ' || v_n end;
end $$;
