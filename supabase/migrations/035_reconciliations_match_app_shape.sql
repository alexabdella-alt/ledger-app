-- =====================================================================
-- 035_reconciliations_match_app_shape.sql
-- Reconcile the reconciliations table with the shape the app actually reads and
-- writes (Option A — match the schema to the code, no code rewrite).
--
-- BACKGROUND: reconciliations was created by migration 005 in a NORMALIZED shape
-- (bank_account_id, statement_date, statement_ending_balance, + a child
-- reconciliation_items table). The app never adopted that model — ReconView and
-- the bank-upload flow both read & write a DENORMALIZED record (account_id,
-- statement/books balances, difference, and jsonb arrays of matched/unmatched
-- transactions). Result: every reconciliations INSERT failed (unknown columns +
-- the unused NOT-NULLs), so reconciliation history silently never persisted.
--
-- This migration (1) adds the 11 denormalized columns the code writes, and
-- (2) relaxes the three NOT-NULL constraints on the now-unused normalized columns
-- so the app's insert succeeds. The normalized columns (bank_account_id,
-- statement_date, statement_ending_balance) and the reconciliation_items table
-- are left in place but are intentionally DEAD SCHEMA — see the CLAUDE.md note;
-- migrating to a proper normalized relational model is a future consideration,
-- not done here. Idempotent; safe on any database.
-- =====================================================================
begin;

-- (1) Columns the app writes (ReconView serialize + bank-upload reconRecord).
-- NB: the app writes `account_id` (nullable; null for a manual reconciliation),
-- which is distinct from the unused normalized `bank_account_id`.
alter table public.reconciliations add column if not exists account_id                  uuid;
alter table public.reconciliations add column if not exists account_name                text;
alter table public.reconciliations add column if not exists period_start                date;
alter table public.reconciliations add column if not exists period_end                  date;
alter table public.reconciliations add column if not exists statement_balance           numeric;
alter table public.reconciliations add column if not exists books_balance               numeric;
alter table public.reconciliations add column if not exists difference                  numeric;
alter table public.reconciliations add column if not exists matched_transactions        jsonb default '[]'::jsonb;
alter table public.reconciliations add column if not exists unmatched_bank              jsonb default '[]'::jsonb;
alter table public.reconciliations add column if not exists unmatched_books             jsonb default '[]'::jsonb;
alter table public.reconciliations add column if not exists added_during_reconciliation jsonb default '[]'::jsonb;

-- (2) Relax NOT-NULL on the normalized columns the app never populates, so the
-- denormalized insert succeeds. (No-op if already nullable.)
alter table public.reconciliations alter column bank_account_id          drop not null;
alter table public.reconciliations alter column statement_date           drop not null;
alter table public.reconciliations alter column statement_ending_balance drop not null;

commit;
