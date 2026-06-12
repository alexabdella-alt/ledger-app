-- =====================================================================
-- 031_journal_entries_update_policy.sql
-- Ensure the RLS UPDATE policy on journal_entries is present and correct, so a
-- company member can persist payment_status / paid_at / payment_method.
--
-- WHY: "Mark as Paid" was silently failing — the UPDATE matched 0 rows with no
-- error (PostgREST returns 204). That is the signature of a missing/ineffective
-- RLS UPDATE policy: SELECT still works (so the row is visible) but UPDATE is
-- filtered out. markBillPaid now detects the 0-row update and fails loudly; this
-- migration fixes the underlying policy. Idempotent — a no-op if 001 already
-- applied it correctly (same name, same predicate).
-- =====================================================================
begin;

alter table public.journal_entries enable row level security;

drop policy if exists journal_entries_update on public.journal_entries;
create policy journal_entries_update on public.journal_entries
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

-- SELECT is needed for the write-verification re-read (and `.select()` on the
-- update) — ensure it too, same shape as 001.
drop policy if exists journal_entries_select on public.journal_entries;
create policy journal_entries_select on public.journal_entries
  for select to authenticated
  using (public.is_company_member(company_id));

commit;
