-- VERIFY 075_bump_rate_limit_acl.sql — RUNNABLE AS-IS.
--
-- (b) is the one that matters. A grant nobody has watched REFUSE is a grant on paper —
-- the standard 071 and 074 were held to, and the reason this hole survived every prior
-- migration is that nobody ever asked the function to run as anon.


-- ── (a) The ACL, read from the catalog. Expect PASS on both rows. ─────────────

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


-- ── (b) ★ BEHAVIOURAL — the revoke is watched to REFUSE. ─────────────────────
-- Rolled back. `set local role anon` drops to the role the public anon key maps to;
-- the call must raise 42501 permission_denied, which is caught and reported as PASS.
-- BEFORE 075 this block returns FAIL, because the call succeeds.

begin;

do $$
declare v_uid uuid;
begin
  select id into v_uid from auth.users order by created_at limit 1;
  set local role anon;
  begin
    perform public.bump_rate_limit(v_uid, 'verify_075');
    reset role;
    raise warning 'FAIL - anon executed bump_rate_limit and incremented a real counter';
  exception
    when insufficient_privilege then
      reset role;
      raise notice 'PASS - anon refused: permission denied for function bump_rate_limit';
  end;
end $$;

select count(*) as leaked_rows,
       case when count(*) = 0 then 'PASS - anon left no counter behind'
            else 'FAIL - anon incremented a counter' end as verdict
  from public.rate_limit
 where bucket = 'verify_075';

rollback;


-- ── (c) service_role still works — the revoke must not break the proxy. ──────
-- Rolled back. Expect allowed=true.

begin;
select public.consume_rate_limit((select id from auth.users order by created_at limit 1),
                                 array['verify_075_ok'], array[10]) as service_role_path;
rollback;


-- ── (d) Nothing left behind. Expect 0 rows. ─────────────────────────────────

select bucket, hour_bucket, count from public.rate_limit where bucket like 'verify_075%';
