-- =====================================================================
-- 050_period_signoffs.sql
-- O50 / O59 — CPA period sign-off (attestation). When all three trust nets
-- are clear (O60 completeness, O49 confidence flags, the O59 accuracy control
-- totals), an admin/CPA marks the period "reviewed through <YYYY-MM>", persisted
-- with WHO + WHEN. Feeds the future owner-facing "reviewed through May" (O90).
-- Apply 001 first (for is_company_member / is_company_admin).
-- =====================================================================
begin;

create extension if not exists "uuid-ossp";

create table if not exists public.period_signoffs (
  id          uuid        default uuid_generate_v4() primary key,
  company_id  uuid        not null references public.companies(id) on delete cascade,
  period      text        not null,                 -- "YYYY-MM" reviewed-through
  signed_by   uuid        not null,                 -- the reviewing user (auth.uid())
  signed_at   timestamptz not null default now(),
  note        text,
  unique (company_id, period)                       -- one sign-off per period (re-sign = update)
);

create index if not exists period_signoffs_company_idx on public.period_signoffs (company_id, period);

alter table public.period_signoffs enable row level security;

-- Any member can SEE what's been reviewed (drives the owner-facing "reviewed through").
drop policy if exists period_signoffs_select on public.period_signoffs;
create policy period_signoffs_select on public.period_signoffs
  for select to authenticated using (public.is_company_member(company_id));

-- Only an admin/owner (the reviewer/CPA) can sign off, and must attribute it to themselves.
drop policy if exists period_signoffs_insert on public.period_signoffs;
create policy period_signoffs_insert on public.period_signoffs
  for insert to authenticated
  with check (public.is_company_admin(company_id) and signed_by = auth.uid());

-- Re-signing a period (after fixing something) updates who/when.
drop policy if exists period_signoffs_update on public.period_signoffs;
create policy period_signoffs_update on public.period_signoffs
  for update to authenticated
  using (public.is_company_admin(company_id))
  with check (public.is_company_admin(company_id) and signed_by = auth.uid());

-- Un-sign (reopen a period) is an admin action too.
drop policy if exists period_signoffs_delete on public.period_signoffs;
create policy period_signoffs_delete on public.period_signoffs
  for delete to authenticated using (public.is_company_admin(company_id));

commit;
