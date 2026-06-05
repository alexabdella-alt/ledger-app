-- =====================================================================
-- 002_create_documents_table.sql
-- Persistent metadata for every uploaded document (invoices, contracts,
-- bank statements, payroll, unknown docs). Powers the Documents tab so
-- uploads survive a page refresh.
--
-- NOTE: base64 file content is intentionally NOT stored here — only
-- metadata. Storing raw file bytes inline would bloat the table and the
-- API responses. (Use Supabase Storage if you later need the file bytes.)
--
-- RLS mirrors the pattern in 001_enable_rls.sql: tenant isolation via
-- public.is_company_member(company_id). Apply 001 first so that helper
-- exists.
-- =====================================================================

begin;

create extension if not exists "uuid-ossp";

create table if not exists public.documents (
  id                uuid        default uuid_generate_v4() primary key,
  company_id        uuid        not null references public.companies(id) on delete cascade,
  file_name         text        not null,
  media_type        text,
  document_type     text,
  tags              jsonb       default '[]',
  ai_explanation    text,
  entry_needed      boolean     default false,
  entry_summary     text,
  posted            boolean     default false,
  linked_invoice_id text,
  uploaded_at       timestamptz default now(),
  created_at        timestamptz default now()
);

create index if not exists documents_company_id_idx on public.documents (company_id);

-- ---------------------------------------------------------------------
-- Row Level Security (same shape as the company-scoped tables in 001).
-- ---------------------------------------------------------------------
alter table public.documents enable row level security;

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents
  for insert to authenticated
  with check (public.is_company_member(company_id));

drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents
  for delete to authenticated
  using (public.is_company_member(company_id));

commit;
