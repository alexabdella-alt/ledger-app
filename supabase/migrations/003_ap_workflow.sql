-- =====================================================================
-- 003_ap_workflow.sql
-- Accounts Payable approval workflow: persist approval + payment state on
-- each journal entry so the Inbox / Approved / Paid / Rejected buckets
-- survive a refresh.
--
-- RLS already covers journal_entries (see 001_enable_rls.sql) — these are
-- just additional columns on the existing table. persistJournalEntry and
-- the AP handlers fall back gracefully (console warning) if this hasn't
-- been applied yet, so the app keeps working in the meantime.
-- =====================================================================

alter table public.journal_entries add column if not exists approval_status  text;     -- pending_approval | approved | rejected | info_requested | flagged
alter table public.journal_entries add column if not exists approved_at      timestamptz;
alter table public.journal_entries add column if not exists approved_by       text;     -- email of approver/rejecter
alter table public.journal_entries add column if not exists rejected_at       timestamptz;
alter table public.journal_entries add column if not exists rejection_reason  text;
alter table public.journal_entries add column if not exists payment_status    text;     -- unpaid | paid | rejected | ...
alter table public.journal_entries add column if not exists payment_method    text;     -- check | ach | wire | card | other
alter table public.journal_entries add column if not exists paid_at           timestamptz;
alter table public.journal_entries add column if not exists due_date          date;
