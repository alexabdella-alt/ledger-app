-- VERIFY (b) — both predicates installed and answering.
--

select
  case when count(*) = 2 then 'PASS - company_has_reviewer and is_company_solo_owner both present'
       else 'FAIL - only ' || count(*) || ' of 2 predicates exist'
  end as verdict
from pg_proc
where proname in ('company_has_reviewer', 'is_company_solo_owner');
