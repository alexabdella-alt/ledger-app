-- 088 VERIFY — one standalone statement per check; paste each alone (the editor shows only
-- the last statement's result).

-- (a) the table and the token constraint
select case when count(*) = 11 then 'PASS - 11 columns' else 'FAIL - ' || count(*) || ' columns' end as verdict
from information_schema.columns where table_schema='public' and table_name='company_channels';

-- (b) RLS on, THREE admin policies (select/insert/update), NO delete
select case when (select relrowsecurity from pg_class where relname='company_channels')
             and count(*) = 3 and bool_and(cmd in ('SELECT','INSERT','UPDATE'))
       then 'PASS - RLS on; select/insert/update for admins; no delete'
       else 'FAIL - ' || count(*) || ' policies: ' || string_agg(cmd, ',') end as verdict
from pg_policies where schemaname='public' and tablename='company_channels';

-- (c) the status view exists and does NOT expose the token
select case when count(*) filter (where column_name='inbound_token') = 0 and count(*) >= 4
       then 'PASS - company_channel_status has no inbound_token column'
       else 'FAIL - view exposes the token or is missing' end as verdict
from information_schema.columns where table_schema='public' and table_name='company_channel_status';

-- (d) THE TOKEN CONSTRAINT REFUSES A GUESSABLE ADDRESS — rolled back on purpose.
do $$
begin
  insert into public.company_channels (company_id, inbound_token)
  values ((select id from public.companies limit 1), 'redriver');
  raise exception 'CHECK RESULT (not an error - rolled back on purpose): FAIL - an 8-char non-random token was accepted';
exception when check_violation then
  raise exception 'CHECK RESULT (not an error - rolled back on purpose): PASS - the token constraint refused "redriver"';
end $$;
