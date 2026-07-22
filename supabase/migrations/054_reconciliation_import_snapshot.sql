-- =====================================================================
-- 054_reconciliation_import_snapshot.sql  (O83 BUG 2)
--
-- The bank-import flow auto-writes a `reconciliations` row (statement_balance 0,
-- books_balance 0) to snapshot what it auto-matched. With status 'complete' it
-- masqueraded as a finished human reconciliation — satisfying the sign-off gate's
-- "period reconciled" precondition, the bank-match freshness signal, and the
-- cash-recon control, all by MERELY uploading a statement (a vacuous pass).
--
-- Fix: give that auto-record a distinct status 'import_snapshot' so it does NOT
-- count as a completed reconciliation (reconciliationCoversPeriod / bankMatchStatus /
-- cash-recon all gate on status='complete'). This relaxes the status CHECK to allow it.
-- (Real reconciliations — a human completion with a verified bank ending balance —
-- keep status 'complete' and are the only ones that count.)
--
-- Apply after 005 (reconciliations table). Idempotent; safe to re-apply.
-- =====================================================================
begin;

alter table public.reconciliations drop constraint if exists reconciliations_status_check;
alter table public.reconciliations
  add constraint reconciliations_status_check
  check (status = any (array['open'::text, 'complete'::text, 'import_snapshot'::text]));

commit;
