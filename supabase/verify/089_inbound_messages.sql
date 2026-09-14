-- 089 VERIFY — one standalone statement per check.

-- (a) columns
select case when count(*) = 16 then 'PASS - 16 columns' else 'FAIL - ' || count(*) || ' columns' end as verdict
from information_schema.columns where table_schema='public' and table_name='inbound_messages';

-- (b) RLS on; members SELECT and UPDATE only — no member INSERT, no DELETE
select case when (select relrowsecurity from pg_class where relname='inbound_messages')
             and count(*) = 2 and bool_and(cmd in ('SELECT','UPDATE'))
       then 'PASS - RLS on; select/update only'
       else 'FAIL - ' || count(*) || ' policies: ' || string_agg(cmd, ',') end as verdict
from pg_policies where schemaname='public' and tablename='inbound_messages';

-- (c) REDELIVERY IS A NO-OP: the same provider message id twice is refused. Rolled back.
do $$
declare c uuid := (select id from public.companies limit 1);
begin
  insert into public.inbound_messages (company_id, provider_message_id, from_email, to_email, status)
  values (c, 'verify-dup-1', 'a@b.c', 'docs-x@in.test', 'accepted');
  insert into public.inbound_messages (company_id, provider_message_id, from_email, to_email, status)
  values (c, 'verify-dup-1', 'a@b.c', 'docs-x@in.test', 'accepted');
  raise exception 'CHECK RESULT (not an error - rolled back on purpose): FAIL - the same provider message id was accepted twice';
exception when unique_violation then
  raise exception 'CHECK RESULT (not an error - rolled back on purpose): PASS - a redelivered message id is refused';
end $$;
