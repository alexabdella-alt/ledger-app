-- 090 VERIFY — one standalone statement per check.

-- (a) columns
select case when count(*) = 19 then 'PASS - 19 columns' else 'FAIL - ' || count(*) || ' columns' end as verdict
from information_schema.columns where table_schema='public' and table_name='outbound_messages';

-- (b) RLS on; members SELECT only — a member cannot insert a "sent" message or move its status
select case when (select relrowsecurity from pg_class where relname='outbound_messages')
             and count(*) = 1 and bool_and(cmd = 'SELECT')
       then 'PASS - RLS on; select only'
       else 'FAIL - ' || count(*) || ' policies: ' || string_agg(cmd, ',') end as verdict
from pg_policies where schemaname='public' and tablename='outbound_messages';

-- (c) A QUESTION WITH NO SUBJECT IS REFUSED — a question about nothing has nowhere for its
--     answer to land. Rolled back.
do $$
begin
  insert into public.outbound_messages (company_id, kind, to_email, subject, body_text, reply_token)
  values ((select id from public.companies limit 1), 'question', 'a@b.c', 's', 'b', 'abcdefghijklmnop');
  raise exception 'CHECK RESULT (not an error - rolled back on purpose): FAIL - a question with no subject was accepted';
exception when check_violation then
  raise exception 'CHECK RESULT (not an error - rolled back on purpose): PASS - a subject-less question is refused';
end $$;

-- (d) AND THE OTHER DIRECTION (079): a report with no subject is ALLOWED. Rolled back.
do $$
begin
  insert into public.outbound_messages (company_id, kind, to_email, subject, body_text, reply_token)
  values ((select id from public.companies limit 1), 'report', 'a@b.c', 's', 'b', 'abcdefghijklmnoq');
  raise exception 'CHECK RESULT (not an error - rolled back on purpose): PASS - a subject-less report is allowed';
exception when check_violation then
  raise exception 'CHECK RESULT (not an error - rolled back on purpose): FAIL - the constraint blocks reports, which have no subject by design';
end $$;

-- (e) the reply FK on inbound_messages now exists
select case when count(*) = 1 then 'PASS - inbound_messages_reply_fk present' else 'FAIL - reply FK missing' end as verdict
from pg_constraint where conname = 'inbound_messages_reply_fk';
