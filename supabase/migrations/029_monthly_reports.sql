-- =====================================================================
-- 029_monthly_reports.sql
-- Automatic monthly financial reports (Item 11). One immutable snapshot per
-- company per month — generated client-side on the first load after the 1st,
-- stored as a jsonb payload, and archived forever.
-- RLS: standard is_company_member tenant isolation, SELECT + INSERT only
--      (reports are immutable — no update/delete policies).
-- Apply 001 first (for is_company_member).
-- =====================================================================
begin;

create extension if not exists "uuid-ossp";

create table if not exists public.monthly_reports (
  id            uuid        default uuid_generate_v4() primary key,
  company_id    uuid        not null references public.companies(id) on delete cascade,
  period        text        not null,            -- 'YYYY-MM', e.g. '2026-05'
  generated_at  timestamptz default now(),
  data          jsonb       not null,            -- the full computed report payload
  unique (company_id, period)                    -- makes double-generation impossible
);
create index if not exists monthly_reports_company_idx
  on public.monthly_reports (company_id, period desc);

alter table public.monthly_reports enable row level security;

drop policy if exists monthly_reports_select on public.monthly_reports;
create policy monthly_reports_select on public.monthly_reports
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists monthly_reports_insert on public.monthly_reports;
create policy monthly_reports_insert on public.monthly_reports
  for insert to authenticated with check (public.is_company_member(company_id));

-- No UPDATE or DELETE policies: reports are immutable snapshots.

commit;
