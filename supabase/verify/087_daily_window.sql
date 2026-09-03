-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFY 087 — run these ONE AT A TIME. The Supabase editor shows only the LAST
-- statement's result, so a pasted block hides every verdict but the final one.
--
-- (c)–(e) are DO blocks that must roll back, so they report through `raise exception`.
-- The editor renders that in red under the word "Failed". THAT IS NOT A FAILURE — read
-- the message: it leads with the fact that it rolled back on purpose.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── (a) the 4-arg function exists, and the 3-arg one SURVIVES ────────────────
-- The old form must still be there: the migration goes live BEFORE the proxy deploy, and
-- the product runs on the old signature in the gap.
select case
  when count(*) filter (where pronargs = 4) = 1
   and count(*) filter (where pronargs = 3) = 1
  then 'PASS - both signatures present (4-arg new, 3-arg kept for the deploy gap)'
  else 'FAIL - saw ' || string_agg(pronargs::text, ',' order by pronargs) || ' arg forms; expected one 3 and one 4'
end as verdict
from pg_proc where proname = 'consume_rate_limit' and pronamespace = 'public'::regnamespace;


-- ── (b) service role only, asked of Postgres's OWN resolver ──────────────────
-- has_function_privilege, not a regex over proacl: an ACL can read clean and still grant
-- EXECUTE through PUBLIC or role inheritance (the O108/075 lesson).
select case
  when not has_function_privilege('anon',          'public.consume_rate_limit(uuid,text[],integer[],integer[])', 'EXECUTE')
   and not has_function_privilege('authenticated', 'public.consume_rate_limit(uuid,text[],integer[],integer[])', 'EXECUTE')
   and     has_function_privilege('service_role',  'public.consume_rate_limit(uuid,text[],integer[],integer[])', 'EXECUTE')
  then 'PASS - anon and authenticated denied, service_role allowed'
  else 'FAIL - anon=' || has_function_privilege('anon','public.consume_rate_limit(uuid,text[],integer[],integer[])','EXECUTE')::text
    || ' authd=' || has_function_privilege('authenticated','public.consume_rate_limit(uuid,text[],integer[],integer[])','EXECUTE')::text
    || ' svc='   || has_function_privilege('service_role','public.consume_rate_limit(uuid,text[],integer[],integer[])','EXECUTE')::text
end as verdict;


-- ── (c) ★★ THE DAILY CAP CAN ACTUALLY FIRE ──────────────────────────────────
-- THE POINT OF THE MIGRATION. Seeds 5 calls spread over 20 hours — all OUTSIDE the hour,
-- all INSIDE the day — then asks with an hourly limit of 60 and a daily limit of 5.
-- Under 086's retention those rows are deleted before they can be counted and this reads
-- ALLOWED: the cap would exist, read correctly, and never once fire.
do $$
declare u uuid := gen_random_uuid(); r jsonb; v text;
begin
  insert into public.rate_limit_events (user_id, bucket, at) values
    (u,'ai', now() - interval '20 hours'), (u,'ai', now() - interval '15 hours'),
    (u,'ai', now() - interval '10 hours'), (u,'ai', now() - interval '5 hours'),
    (u,'ai', now() - interval '2 hours');
  r := public.consume_rate_limit(u, array['ai'], array[60], array[5]);
  v := case
    when (r->>'allowed')::boolean = false and r->>'blocked_window' = 'day'
      then 'PASS - refused by the DAY while the HOUR was empty (0 of 60 used); resets in '
           || (r->>'resets_in_minutes') || ' minutes'
    when (r->>'allowed')::boolean = true
      then 'FAIL - ALLOWED. The daily cap cannot see its own history: retention is still pruning at the hour.'
    else 'FAIL - refused by ' || coalesce(r->>'blocked_window','?') || '/' || coalesce(r->>'blocked_bucket','?') end;
  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): %', v;
end $$;


-- ── (d) ★★ A DAILY REFUSAL CHARGES NOTHING — O113a, extended ────────────────
-- The whole of O113a is that a refusal must not consume budget. A daily refusal must not
-- charge the HOUR either, or retrying digs the hole deeper in a window that was fine.
do $$
declare u uuid := gen_random_uuid(); r jsonb; n_before int; n_after int; v text;
begin
  insert into public.rate_limit_events (user_id, bucket, at) values
    (u,'ai', now() - interval '20 hours'), (u,'ai', now() - interval '15 hours'),
    (u,'ai', now() - interval '10 hours');
  select count(*) into n_before from public.rate_limit_events where user_id = u;
  r := public.consume_rate_limit(u, array['ai'], array[60], array[3]);
  select count(*) into n_after  from public.rate_limit_events where user_id = u;
  v := case
    when (r->>'allowed')::boolean = false and n_after = n_before
      then 'PASS - refused by the day, and NOTHING was charged (' || n_before || ' -> ' || n_after || ')'
    when (r->>'allowed')::boolean = false
      then 'FAIL - refused BUT CHARGED (' || n_before || ' -> ' || n_after || ') - this is O113a returning'
    else 'FAIL - not refused at all' end;
  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): %', v;
end $$;


-- ── (e) ★★ IT DOES NOT BLOCK TOO MUCH — the 079 direction ───────────────────
-- For a guard, "it fails to block" is the obvious failure and the unlikely one. "It blocks
-- work that should pass" is the dangerous one: it breaks ordinary use and only surfaces
-- when someone tries to do their job. A user well inside both windows must be ALLOWED,
-- and `remaining` must report the MIN across windows, not the comfortable one.
do $$
declare u uuid := gen_random_uuid(); r jsonb; v text;
begin
  insert into public.rate_limit_events (user_id, bucket, at)
    select u, 'ai', now() - (interval '1 hour' * g) from generate_series(2, 11) g;   -- 10 calls, all older than an hour
  r := public.consume_rate_limit(u, array['ai'], array[300], array[1200]);
  v := case
    when (r->>'allowed')::boolean = true and (r->'remaining'->>'ai')::int = 299
      then 'PASS - allowed, and remaining reports the min across windows (hour 299, day 1189 -> 299)'
    when (r->>'allowed')::boolean = true
      then 'FAIL - allowed but remaining=' || (r->'remaining'->>'ai') || ', expected 299 (the tighter window)'
    else 'FAIL - REFUSED a user inside both windows: blocked by '
         || coalesce(r->>'blocked_window','?') || '/' || coalesce(r->>'blocked_bucket','?') end;
  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): %', v;
end $$;
