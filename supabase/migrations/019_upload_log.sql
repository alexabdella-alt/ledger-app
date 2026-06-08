-- =====================================================================
-- 019_upload_log.sql
-- A persistent record of every file upload attempt — one row per file,
-- updated as processing progresses (pending → classifying → processing →
-- done | error). Survives refresh and gives an audit/debug trail of what
-- was uploaded, how it was classified, and whether it succeeded.
-- Mirrors the in-memory uploadQueue item shape.
--
-- RLS follows 001/002: tenant isolation via is_company_member(company_id).
-- Apply 001 first (for the helper) and 002 (documents) for the document_id link.
-- =====================================================================

begin;

create extension if not exists "uuid-ossp";

create table if not exists public.upload_log (
  id              uuid        default uuid_generate_v4() primary key,
  company_id      uuid        not null references public.companies(id) on delete cascade,
  uploaded_by     uuid,                       -- auth.uid() of the uploader
  file_name       text        not null,
  file_type       text,                       -- mime type / extension
  file_size_bytes bigint,                     -- size of the uploaded file
  doc_type        text,                       -- invoice | bank_statement | contract | unknown
  status          text        not null default 'processing',  -- processing | done | error
  result          jsonb,                      -- summary (counts, vendor, amount, gl, …)
  error           text,                       -- failure message when status = 'error'
  document_id     uuid        references public.documents(id) on delete set null,  -- optional link
  created_at      timestamptz default now(),
  completed_at    timestamptz                 -- set when status becomes done/error
);

create index if not exists upload_log_company_id_idx     on public.upload_log (company_id);
create index if not exists upload_log_company_created_idx on public.upload_log (company_id, created_at desc);

-- ---------------------------------------------------------------------
-- Row Level Security — same shape as the company-scoped tables in 001.
-- ---------------------------------------------------------------------
alter table public.upload_log enable row level security;

drop policy if exists upload_log_select on public.upload_log;
create policy upload_log_select on public.upload_log
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists upload_log_insert on public.upload_log;
create policy upload_log_insert on public.upload_log
  for insert to authenticated
  with check (public.is_company_member(company_id));

drop policy if exists upload_log_update on public.upload_log;
create policy upload_log_update on public.upload_log
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists upload_log_delete on public.upload_log;
create policy upload_log_delete on public.upload_log
  for delete to authenticated
  using (public.is_company_member(company_id));

commit;
