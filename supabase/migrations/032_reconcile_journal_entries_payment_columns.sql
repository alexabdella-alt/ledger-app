-- =====================================================================
-- 032_reconcile_journal_entries_payment_columns.sql
-- Schema-drift reconciliation for journal_entries.
--
-- journal_entries was created by hand BEFORE migration 001, and migrations
-- 003 (AP workflow) and 004 (payment details) were applied piecemeal during
-- development — so on the live database several payment/approval columns the
-- client writes never actually landed. The symptom: "Mark as Paid" issued an
-- UPDATE that set paid_at, PostgREST rejected the non-existent column, and the
-- update matched 0 rows (the canonical writer's authoritative failure signal),
-- so the paid state never persisted and reverted on refresh.
--
-- This migration RE-ASSERTS every payment/approval column the app reads or
-- writes, idempotently (add column if not exists), so any database — fresh or
-- partially-migrated — converges to the schema the code expects. It is a
-- superset of the relevant columns in 003 and 004; running it after them is a
-- no-op, running it instead of them is complete.
-- RLS already covers journal_entries (001); these are columns only.
-- =====================================================================
begin;

-- ── Payment state (written by persistApStatus / markBillPaid) ──
alter table public.journal_entries add column if not exists payment_status    text;        -- unpaid | paid | collected | rejected | partial | null
alter table public.journal_entries add column if not exists payment_method    text;        -- ach | check | wire | card | zelle | venmo | paypal | other
alter table public.journal_entries add column if not exists paid_at           timestamptz; -- when the bill was paid / invoice collected
alter table public.journal_entries add column if not exists payment_reference text;         -- check #, ACH trace, confirmation code
alter table public.journal_entries add column if not exists payment_notes     text;         -- free-text payment memo
alter table public.journal_entries add column if not exists due_date          date;

-- ── Approval workflow (written by approveInvoice / rejectInvoice / requestInfo) ──
alter table public.journal_entries add column if not exists approval_status   text;         -- pending_approval | approved | rejected | info_requested | flagged
alter table public.journal_entries add column if not exists approved_at       timestamptz;
alter table public.journal_entries add column if not exists approved_by       text;         -- email of approver/rejecter
alter table public.journal_entries add column if not exists rejected_at       timestamptz;
alter table public.journal_entries add column if not exists rejection_reason  text;

commit;
