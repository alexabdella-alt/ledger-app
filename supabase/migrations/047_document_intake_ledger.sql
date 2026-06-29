-- 047 — Document Completeness Guarantee (O60): the INDEPENDENT intake ledger.
--
-- Completeness cannot be verified against the same pipeline that does the recording —
-- a bug that drops a document also drops it from a self-referential check. So every
-- document entering the system is logged HERE FIRST, on arrival, BEFORE any AI/parsing/
-- booking, by a dead-simple insert. The recording pipeline only ANNOTATES this row's
-- status as the doc moves through; it never owns the population. The reconciliation check
-- (src/lib/documentIntake.js reconcileIntake / fetchDroppedIntake) reads this table, so it
-- sees documents even when the processing pipeline lost them — the bulletproof property.
--
-- Idempotent. Apply in the Supabase SQL editor.

begin;

create table if not exists public.document_intake (
  id uuid primary key default extensions.uuid_generate_v4(),
  company_id uuid not null,
  received_at timestamptz not null default now(),
  filename text,
  content_hash text,                                  -- sha-256 of the bytes: identity + dupe detection
  source text not null default 'upload',              -- upload | email | inbox | ...
  uploaded_by uuid,
  status text not null default 'received',
  journal_entry_ids uuid[] not null default '{}',     -- linked resulting JE(s) when recorded
  document_id uuid,                                   -- ties O74 (the stored file), when present
  detail text,                                       -- reason for held_for_review / rejected / failed
  updated_at timestamptz not null default now(),
  constraint document_intake_status_check
    check (status in ('received','processing','recorded','held_for_review','rejected','failed'))
);

create index if not exists document_intake_company_status_idx on public.document_intake (company_id, status);
create index if not exists document_intake_company_received_idx on public.document_intake (company_id, received_at);
create index if not exists document_intake_hash_idx on public.document_intake (company_id, content_hash);

-- RLS: tenant-isolated like every business table (§3) — four is_company_member policies.
alter table public.document_intake enable row level security;

drop policy if exists document_intake_select on public.document_intake;
create policy document_intake_select on public.document_intake
  for select using (public.is_company_member(company_id));

drop policy if exists document_intake_insert on public.document_intake;
create policy document_intake_insert on public.document_intake
  for insert with check (public.is_company_member(company_id));

drop policy if exists document_intake_update on public.document_intake;
create policy document_intake_update on public.document_intake
  for update using (public.is_company_member(company_id));

drop policy if exists document_intake_delete on public.document_intake;
create policy document_intake_delete on public.document_intake
  for delete using (public.is_company_member(company_id));

commit;
