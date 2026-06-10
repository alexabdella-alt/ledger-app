-- =====================================================================
-- 023_accounts_rls.sql
-- Row Level Security for the chart-of-accounts table.
--
-- SECURITY FIX (OWASP A01 — Broken Access Control): every other tenant table
-- is RLS-protected via is_company_member(company_id), but `accounts` was not
-- enabled in the tracked migrations. Without this, an authenticated user could
-- read or modify ANOTHER company's chart of accounts directly through the REST
-- API (the client-side .eq("company_id", …) filter is not a security boundary).
--
-- Idempotent: safe to run even if RLS was already enabled manually. Apply 001
-- first (for the is_company_member helper).
-- =====================================================================

begin;

alter table public.accounts enable row level security;

drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists accounts_insert on public.accounts;
create policy accounts_insert on public.accounts
  for insert to authenticated
  with check (public.is_company_member(company_id));

drop policy if exists accounts_update on public.accounts;
create policy accounts_update on public.accounts
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists accounts_delete on public.accounts;
create policy accounts_delete on public.accounts
  for delete to authenticated
  using (public.is_company_member(company_id));

commit;
