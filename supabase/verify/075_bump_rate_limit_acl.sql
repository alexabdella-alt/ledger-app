-- VERIFY 075_bump_rate_limit_acl.sql — RUNNABLE AS-IS. Paste each block WHOLE.
--
-- (b) is the one that matters. A grant nobody has watched REFUSE is a grant on paper —
-- the standard 071 and 074 were held to, and the reason this hole survived every prior
-- migration is that nobody ever asked the function to run as anon.
--
-- ★ RUN (b) BEFORE APPLYING 075 TOO. It must return FAIL. That is the hole demonstrated
--   rather than described, and it is what makes the later PASS mean something.
--
-- Every verdict is returned as a RESULT SET, never as RAISE NOTICE — the SQL editor does
-- not reliably surface notices, and a check whose result you cannot see is a check you did
-- not run.


-- ══════════════════════════════════════════════════════════════════════════════
-- (a) The ACL, read from the catalog. Expect 2 rows, both PASS after 075.
-- ══════════════════════════════════════════════════════════════════════════════

select p.proname,
       p.proacl::text as acl,
       case
         when p.proacl::text like '%anon=%' or p.proacl::text like '%authenticated=%'
           then 'FAIL - anon and/or authenticated still hold EXECUTE'
         when p.proacl::text like '%service_role=%'
           then 'PASS - service_role only'
         else 'FAIL - service_role grant missing; the proxy and 074 rollback both break'
       end as verdict
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('bump_rate_limit', 'consume_rate_limit')
 order by p.proname;


-- ══════════════════════════════════════════════════════════════════════════════
-- (b) ★ BEHAVIOURAL — the revoke is watched to REFUSE. Expect 2 rows.
-- Rolled back, so nothing survives either way.
--   BEFORE 075: anon_execute = FAIL  (the hole)
--   AFTER  075: anon_execute = PASS  (refused)
-- ══════════════════════════════════════════════════════════════════════════════

begin;

create temp table v075 (step text primary key, verdict text) on commit drop;

do $$
declare v_uid uuid;
begin
  select id into v_uid from auth.users order by created_at limit 1;
  begin
    set local role anon;
    perform public.bump_rate_limit(v_uid, 'verify_075');
    reset role;
    insert into v075 values
      ('1_anon_execute', 'FAIL - anon EXECUTED bump_rate_limit and moved a real counter');
  exception
    when insufficient_privilege then
      reset role;
      insert into v075 values
        ('1_anon_execute', 'PASS - anon refused: permission denied for function bump_rate_limit');
  end;
end $$;

insert into v075
select '2_no_counter_left',
       case when count(*) = 0
            then 'PASS - anon left no counter behind'
            else 'FAIL - anon incremented ' || count(*) || ' counter row(s)' end
  from public.rate_limit
 where bucket = 'verify_075';

select step, verdict from v075 order by step;

rollback;


-- ══════════════════════════════════════════════════════════════════════════════
-- (c) service_role still works — the revoke must not break the proxy or 074's
-- rollback path. Expect allowed=true. Rolled back.
-- ══════════════════════════════════════════════════════════════════════════════

begin;

select public.consume_rate_limit((select id from auth.users order by created_at limit 1),
                                 array['verify_075_ok'], array[10]) as service_role_path,
       case when (public.consume_rate_limit(
                    (select id from auth.users order by created_at limit 1),
                    array['verify_075_ok2'], array[10])->>'allowed')::boolean
            then 'PASS - service_role path intact'
            else 'FAIL - service_role refused; the proxy would 429 on every call' end as verdict;

rollback;


-- ══════════════════════════════════════════════════════════════════════════════
-- (d) Nothing left behind. Expect 0 rows.
-- ══════════════════════════════════════════════════════════════════════════════

select bucket, hour_bucket, count from public.rate_limit where bucket like 'verify_075%';
