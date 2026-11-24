-- 103 — THE FREE TRIAL IS 30 DAYS (C773; operator, 2026-11-24: "a full 30 days, they need a month").
--
-- Migration 102 started a new company's trial from a trigger at 14 days. This is 102's function
-- VERBATIM with the one interval changed (diffed mechanically against 102 — the function was created
-- by 102 from that same file, sha 15e7517f…, so the repo text IS the live text). Existing rows are
-- untouched: existing companies get their fresh 30 days at launch, as a separate step.
--
-- Apply on the operator's go-ahead. Verify with supabase/verify/103_trial_30_days.sql.

begin;

create or replace function public.start_company_trial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not exists (select 1 from public.subscriptions s where s.company_id = new.id) then
    insert into public.subscriptions (company_id, plan, status, trial_ends_at)
    values (new.id, 'trial', 'trialing', now() + interval '30 days');
  end if;
  return new;
end;
$fn$;
revoke all on function public.start_company_trial() from public, anon, authenticated;

commit;
