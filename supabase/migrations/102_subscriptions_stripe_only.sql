-- 102 — A COMPANY'S PLAN IS WRITTEN BY STRIPE ONLY (C771).
--
-- `subscriptions` carried member-level INSERT / UPDATE / DELETE policies (baseline `000`), so any
-- member of a company could mark their own company "active" on any plan from the browser — harmless
-- while nothing read the row, a free pass once billing gates anything. From here:
--   • members may still READ their company's row (the Plan & billing page);
--   • nobody signed in may write it — only the service role (the `stripe-webhook` and `billing`
--     edge functions), which bypasses RLS;
--   • a new company gets its 14-day trial row from a trigger, server-side — CompanySetup's own insert
--     finds the row already there and skips (it checks first), so sign-up is unchanged.
-- Existing rows are untouched.
--
-- Apply in the Supabase SQL editor (or `supabase db query --linked -f`) on the operator's go-ahead.
-- Verify with supabase/verify/102_subscriptions_stripe_only.sql.

begin;

drop policy if exists subscriptions_insert on public.subscriptions;
drop policy if exists subscriptions_update on public.subscriptions;
drop policy if exists subscriptions_delete on public.subscriptions;
revoke insert, update, delete on public.subscriptions from anon, authenticated;

create or replace function public.start_company_trial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not exists (select 1 from public.subscriptions s where s.company_id = new.id) then
    insert into public.subscriptions (company_id, plan, status, trial_ends_at)
    values (new.id, 'trial', 'trialing', now() + interval '14 days');
  end if;
  return new;
end;
$fn$;
revoke all on function public.start_company_trial() from public, anon, authenticated;

drop trigger if exists companies_start_trial on public.companies;
create trigger companies_start_trial after insert on public.companies
  for each row execute function public.start_company_trial();

commit;
