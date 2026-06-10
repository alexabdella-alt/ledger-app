-- =====================================================================
-- 028_qbo_import.sql
-- QuickBooks Online import (Item 43): provenance + undo support.
--   1. import_batch_id / import_metadata columns on journal_entries
--   2. allow source = 'qbo_import' in the CHECK constraint
--   3. qbo_imports batch table (recent-imports list + one-click undo)
-- Apply 001 first (for is_company_member / is_company_admin).
-- =====================================================================
begin;

create extension if not exists "uuid-ossp";

-- ── 1. Provenance on each imported entry ──
alter table public.journal_entries add column if not exists import_batch_id uuid;
alter table public.journal_entries add column if not exists import_metadata jsonb;
create index if not exists journal_entries_import_batch_idx
  on public.journal_entries (import_batch_id) where import_batch_id is not null;

-- ── 2. Allow source = 'qbo_import' (recreate the CHECK with the existing set + qbo) ──
alter table public.journal_entries drop constraint if exists journal_entries_source_check;
alter table public.journal_entries add constraint journal_entries_source_check
  check (source in ('manual','bank_import','universal_upload','recurring',
                    'opening_balance','ar_invoice','payroll','api','qbo_import'));

-- ── 3. Import batch records — drive the "recent imports" list + undo ──
create table if not exists public.qbo_imports (
  id             uuid        default uuid_generate_v4() primary key,
  company_id     uuid        not null references public.companies(id) on delete cascade,
  filename       text,
  row_count      integer     default 0,   -- rows detected in the file
  imported_count integer     default 0,   -- entries actually booked
  skipped_count  integer     default 0,   -- exact duplicates skipped
  failed_count   integer     default 0,   -- rows that failed validation
  total_amount   numeric     default 0,
  status         text        default 'completed',   -- completed | undone
  created_by     uuid,
  created_at     timestamptz default now(),
  undone_at      timestamptz
);
create index if not exists qbo_imports_company_idx on public.qbo_imports (company_id, created_at desc);

alter table public.qbo_imports enable row level security;

drop policy if exists qbo_imports_select on public.qbo_imports;
create policy qbo_imports_select on public.qbo_imports
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists qbo_imports_insert on public.qbo_imports;
create policy qbo_imports_insert on public.qbo_imports
  for insert to authenticated with check (public.is_company_admin(company_id));

drop policy if exists qbo_imports_update on public.qbo_imports;
create policy qbo_imports_update on public.qbo_imports
  for update to authenticated
  using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

drop policy if exists qbo_imports_delete on public.qbo_imports;
create policy qbo_imports_delete on public.qbo_imports
  for delete to authenticated using (public.is_company_admin(company_id));

commit;
