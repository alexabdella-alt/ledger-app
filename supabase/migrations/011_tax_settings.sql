-- =====================================================================
-- 011_tax_settings.sql
-- Per-company, per-year tax compliance state (estimated payments made,
-- filed deadlines, work-from-home flag). Replaces the localStorage blob
-- TaxView used (cfai_tax_<companyId>) so this audit-relevant data is
-- synced, multi-device, and RLS-protected.
-- =====================================================================

create table if not exists public.tax_settings (
  id                      uuid default uuid_generate_v4() primary key,
  company_id              uuid not null references public.companies(id) on delete cascade,
  tax_year                integer not null,
  estimated_payments_made numeric default 0,
  work_from_home          boolean default false,
  filed_deadlines         jsonb default '[]'::jsonb,
  notes                   text,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now(),
  unique (company_id, tax_year)
);

create index if not exists tax_settings_company_idx on public.tax_settings (company_id, tax_year);

alter table public.tax_settings enable row level security;

drop policy if exists tax_settings_select on public.tax_settings;
create policy tax_settings_select on public.tax_settings
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists tax_settings_insert on public.tax_settings;
create policy tax_settings_insert on public.tax_settings
  for insert to authenticated with check (public.is_company_member(company_id));

drop policy if exists tax_settings_update on public.tax_settings;
create policy tax_settings_update on public.tax_settings
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists tax_settings_delete on public.tax_settings;
create policy tax_settings_delete on public.tax_settings
  for delete to authenticated using (public.is_company_member(company_id));

-- Keep updated_at fresh on writes.
create or replace function public.touch_tax_settings_updated_at()
returns trigger language plpgsql as $t$
begin
  new.updated_at := now();
  return new;
end;
$t$;

drop trigger if exists trg_tax_settings_updated_at on public.tax_settings;
create trigger trg_tax_settings_updated_at
  before update on public.tax_settings
  for each row execute function public.touch_tax_settings_updated_at();
