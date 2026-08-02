-- =====================================================================
-- 058_bank_statements.sql
-- C185 — Pipeline foundation (§11 ★ North Star, Phase 1-A): persist bank
-- statements + their lines as durable DB records, and add the bank_account_id
-- linkage on journal_entries.
--
-- Today handleBankFile parses a statement into React state only. For the pipeline
-- (next commit) to orchestrate over statements — and for Reconcile to stop
-- re-parsing (§11 "reconcile should not re-upload") and the doc library to hold
-- bank statements (§11 "Document library misses bank statements") — the parsed
-- statement + its lines must be queryable, and booked entries must carry the
-- bank_account_id they belong to (the missing linkage §11 keeps citing).
--
-- Additive + idempotent. Manual apply (CLAUDE.md §6 — do NOT db push). RLS mirrors
-- the standard company-scoped four-policy shape (is_company_member). Apply 001 first.
-- =====================================================================
begin;

create extension if not exists "uuid-ossp";

-- ── STATEMENTS: one row per uploaded bank statement ──────────────────────────
create table if not exists public.bank_statements (
  id                      uuid        default uuid_generate_v4() primary key,
  company_id              uuid        not null references public.companies(id) on delete cascade,
  bank_account_id         uuid        references public.bank_accounts(id),           -- nullable: the account it belongs to
  document_id             uuid        references public.documents(id),               -- nullable: doc-library linkage (the stored file)
  period_start            date,
  period_end              date,
  stated_opening_balance  numeric,
  stated_ending_balance   numeric,
  source_filename         text,
  status                  text        not null default 'parsed'
                            check (status in ('parsed','processing','complete','attention')),
  created_at              timestamptz not null default now()
);

-- ── LINES: one row per parsed transaction on a statement ─────────────────────
create table if not exists public.bank_statement_lines (
  id                uuid        default uuid_generate_v4() primary key,
  statement_id      uuid        not null references public.bank_statements(id) on delete cascade,
  company_id        uuid        not null references public.companies(id) on delete cascade,
  line_date         date,
  description       text,
  vendor            text,
  amount            numeric,
  direction         text        check (direction in ('in','out')),
  fingerprint       text,                                                            -- content-dedup key (bankTxnKey identity)
  status            text        not null default 'pending'
                      check (status in ('pending','booked','matched','already_booked','excepted')),
  journal_entry_id  uuid        references public.journal_entries(id),               -- set once the line books/clears
  exception_reason  text,
  ai_gl_code        text,
  ai_confidence     numeric,
  created_at        timestamptz not null default now()
);

-- ── LINKAGE: a booked/cleared entry carries the bank account it belongs to ────
alter table public.journal_entries
  add column if not exists bank_account_id uuid references public.bank_accounts(id);

create index if not exists bank_statements_company_idx        on public.bank_statements (company_id);
create index if not exists bank_statement_lines_company_stmt_idx on public.bank_statement_lines (company_id, statement_id);
create index if not exists journal_entries_bank_account_idx    on public.journal_entries (bank_account_id);

alter table public.bank_statements      enable row level security;
alter table public.bank_statement_lines enable row level security;

-- Standard tenant isolation: the four is_company_member(company_id) policies (§3).
drop policy if exists bank_statements_select on public.bank_statements;
create policy bank_statements_select on public.bank_statements
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists bank_statements_insert on public.bank_statements;
create policy bank_statements_insert on public.bank_statements
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists bank_statements_update on public.bank_statements;
create policy bank_statements_update on public.bank_statements
  for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
drop policy if exists bank_statements_delete on public.bank_statements;
create policy bank_statements_delete on public.bank_statements
  for delete to authenticated using (public.is_company_member(company_id));

drop policy if exists bank_statement_lines_select on public.bank_statement_lines;
create policy bank_statement_lines_select on public.bank_statement_lines
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists bank_statement_lines_insert on public.bank_statement_lines;
create policy bank_statement_lines_insert on public.bank_statement_lines
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists bank_statement_lines_update on public.bank_statement_lines;
create policy bank_statement_lines_update on public.bank_statement_lines
  for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
drop policy if exists bank_statement_lines_delete on public.bank_statement_lines;
create policy bank_statement_lines_delete on public.bank_statement_lines
  for delete to authenticated using (public.is_company_member(company_id));

commit;
