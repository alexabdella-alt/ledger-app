-- 075 — ONE STATEMENT, ONE VERDICT ROW. No side effects, no transaction, nothing to clean up.
--
-- ★ WHY `has_function_privilege` AND NOT A REGEX OVER `proacl`:
-- this is POSTGRES'S OWN PRIVILEGE RESOLVER — the same code path the executor consults
-- before it runs a function. It accounts for PUBLIC grants, role membership and
-- inheritance, all of which a `proacl LIKE '%anon=%'` string match silently misses. An
-- ACL can read clean and still grant EXECUTE through PUBLIC; this cannot.
--
-- HONEST BOUNDARY: it is the executor's DECISION, not the executor's REFUSAL. It proves
-- Postgres will deny anon, not that we watched it deny anon. That distinction is why the
-- behavioural block exists — see 075_bump_rate_limit_acl.sql (b) — and it is the last
-- thing owed on this migration.

select
  has_function_privilege('anon',          'public.bump_rate_limit(uuid,text)', 'EXECUTE') as anon_exec,
  has_function_privilege('authenticated', 'public.bump_rate_limit(uuid,text)', 'EXECUTE') as authd_exec,
  has_function_privilege('service_role',  'public.bump_rate_limit(uuid,text)', 'EXECUTE') as svc_exec,
  case
    when has_function_privilege('anon',          'public.bump_rate_limit(uuid,text)', 'EXECUTE')
      then 'FAIL - anon can still EXECUTE bump_rate_limit'
    when has_function_privilege('authenticated', 'public.bump_rate_limit(uuid,text)', 'EXECUTE')
      then 'FAIL - authenticated can still EXECUTE bump_rate_limit'
    when not has_function_privilege('service_role', 'public.bump_rate_limit(uuid,text)', 'EXECUTE')
      then 'FAIL - service_role lost EXECUTE; the proxy and 074 rollback both break'
    else 'PASS - anon and authenticated refused; service_role retained'
  end as verdict;
