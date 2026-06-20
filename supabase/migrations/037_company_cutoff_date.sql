-- =====================================================================
-- 037_company_cutoff_date.sql
-- Clean-cutoff conversion model (governing principle): every company has ONE
-- cutoff/conversion date ("Day One"). Opening balances are the prior trial
-- balance as of this date; no transaction may be dated before it. Idempotent.
-- =====================================================================
begin;

alter table public.companies add column if not exists cutoff_date date;
comment on column public.companies.cutoff_date is
  'Conversion "Day One": opening balances are the trial balance as of this date; no transactions may be dated before it. Locked once the opening entry is posted.';

commit;
