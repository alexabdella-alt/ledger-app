-- =====================================================================
-- 057_reconciliation_outstanding_books.sql
-- O83 Feb — persist the "hasn't hit the bank yet" (outstanding check /
-- deposit-in-transit) markings on a reconciliation.
--
-- ReconView lets the user mark a book item outstanding; that item must NET the
-- reconciliation difference (bank + Σ(outstanding) − books) AND survive Save
-- Progress/resume, and a COMPLETED record must show what was outstanding at the
-- time. The denormalized reconciliations record stored matched/unmatched jsonb but
-- had no home for the outstanding set, so the marking was lost on save. This adds it.
-- Idempotent; additive (safe on the live table). Apply 035 first (denormalized cols).
-- =====================================================================
begin;

alter table public.reconciliations
  add column if not exists outstanding_books jsonb not null default '[]'::jsonb;

commit;
