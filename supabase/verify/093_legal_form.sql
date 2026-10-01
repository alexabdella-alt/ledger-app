-- 093 — three checks. Paste ONE AT A TIME; each returns a single verdict row.

-- (A) the column exists, nullable, and every existing company is still NULL (unanswered)
select case
  when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'legal_form')
    then 'FAIL - companies.legal_form does not exist'
  when (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'legal_form') <> 'YES'
    then 'FAIL - legal_form is NOT NULL (it must allow "not answered")'
  else 'PASS - companies.legal_form exists and allows "not answered" (' ||
       (select count(*) from public.companies where legal_form is not null) || ' companies have answered)'
end as verdict;

-- (B) the constraint allows exactly the four tax classifications
select case
  when pg_get_constraintdef(c.oid) like '%sole_prop%' and pg_get_constraintdef(c.oid) like '%partnership%'
   and pg_get_constraintdef(c.oid) like '%s_corp%' and pg_get_constraintdef(c.oid) like '%c_corp%'
    then 'PASS - companies_legal_form_check allows sole_prop, partnership, s_corp, c_corp'
  else 'FAIL - the constraint is present but does not list the four values: ' || pg_get_constraintdef(c.oid)
end as verdict
from pg_constraint c
where c.conname = 'companies_legal_form_check'
union all
select 'FAIL - companies_legal_form_check does not exist'
where not exists (select 1 from pg_constraint where conname = 'companies_legal_form_check');

-- (C) it REFUSES something — a constraint nobody has watched reject anything is on paper only.
-- Rolls back on purpose; the red "Failed to run" is the report, not a failure.
do $$
declare v text; c uuid;
begin
  select id into c from public.companies limit 1;
  begin
    update public.companies set legal_form = 'llc' where id = c;
    v := 'FAIL - the column accepted "llc", which is not a tax classification';
  exception when check_violation then
    v := 'PASS - refused "llc" (check_violation)';
  end;
  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): %', v;
end $$;
