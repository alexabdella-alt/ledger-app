-- =====================================================================
-- 022_client_ai_profile.sql
-- A per-company "business profile" the AI builds up over time so it gets
-- smarter for each specific client. One row per company. Written by the
-- app (as the authenticated owner) after confirmed bookings and
-- clarification answers; read into the AI system prompt on every chat.
--
-- RLS follows 001/019: tenant isolation via is_company_member(company_id),
-- so a company can only ever read/write its OWN profile row. Apply 001 first
-- (for the is_company_member helper).
-- =====================================================================

begin;

create extension if not exists "uuid-ossp";

create table if not exists public.client_ai_profile (
  id                uuid        default uuid_generate_v4() primary key,
  company_id        uuid        not null unique
                                references public.companies(id) on delete cascade,
  business_type     text,                          -- e.g. "SaaS", "restaurant", "consulting"
  common_vendors    jsonb       not null default '{}'::jsonb,  -- { vendorLower: {name, gl_code, gl_name, count, last_seen} }
  spending_patterns jsonb       not null default '{}'::jsonb,  -- { category: {total, count, months:{ "YYYY-MM": amount }} }
  custom_rules      jsonb       not null default '[]'::jsonb,  -- ["learned fact 1", ...] things learned about THIS business
  ai_notes          text,                          -- free-form observations the AI has made
  updated_at        timestamptz not null default now()
);

create index if not exists client_ai_profile_company_idx on public.client_ai_profile (company_id);

-- ---------------------------------------------------------------------
-- Row Level Security — same company-scoped shape as upload_log (019).
-- ---------------------------------------------------------------------
alter table public.client_ai_profile enable row level security;

drop policy if exists client_ai_profile_select on public.client_ai_profile;
create policy client_ai_profile_select on public.client_ai_profile
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists client_ai_profile_insert on public.client_ai_profile;
create policy client_ai_profile_insert on public.client_ai_profile
  for insert to authenticated
  with check (public.is_company_member(company_id));

drop policy if exists client_ai_profile_update on public.client_ai_profile;
create policy client_ai_profile_update on public.client_ai_profile
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists client_ai_profile_delete on public.client_ai_profile;
create policy client_ai_profile_delete on public.client_ai_profile
  for delete to authenticated
  using (public.is_company_member(company_id));

commit;
