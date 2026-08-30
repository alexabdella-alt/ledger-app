-- VERIFY (a) — the column exists, defaults false, and no existing row claims otherwise.
--

select
  count(*) filter (where self_attested) as already_flagged,
  count(*)                              as total,
  case when count(*) filter (where self_attested) = 0
       then 'PASS - column present; no historical row claims self-attestation (all were reviewer-written)'
       else 'FAIL - ' || count(*) filter (where self_attested) || ' pre-existing row(s) marked self_attested'
  end as verdict
from public.period_signoffs;
