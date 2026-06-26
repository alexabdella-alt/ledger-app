-- 045_drop_ap_invoices.sql
-- Drop the orphaned `ap_invoices` table (O19). It is a fully-structured parallel
-- AP-invoice model that ZERO app code references — payables are booked to
-- `journal_entries` (verified: grep of src/ finds no reference; the only mentions are
-- this table's own DDL in 000_baseline_schema.sql plus the dead `ap_aging` view that
-- reads from it, which no app code uses either — reports.js `agingReport` is computed
-- client-side from the ledger).
--
-- SAFETY: this migration is SELF-GUARDED — it RAISES and aborts if `ap_invoices` has
-- any rows, so it can never silently destroy data. If it errors with a row count,
-- investigate before proceeding (do NOT force the drop). Apply in the Supabase SQL
-- editor after reviewing. Idempotent: a no-op if the table is already gone.
--
-- Dependency: the `ap_aging` VIEW reads from `ap_invoices`, so it's dropped first.
-- (`ar_aging` and `trial_balance` are independent — they do NOT reference ap_invoices.)

begin;

do $$
declare
  n bigint;
begin
  if to_regclass('public.ap_invoices') is null then
    raise notice 'ap_invoices is already absent — nothing to drop.';
    return;
  end if;

  select count(*) into n from public.ap_invoices;
  if n > 0 then
    raise exception 'ap_invoices has % row(s) — NOT dropping. Investigate first (this table was believed orphaned/empty).', n;
  end if;

  drop view if exists public.ap_aging;
  drop table public.ap_invoices;
  raise notice 'Dropped orphaned ap_invoices (and its dead ap_aging view).';
end $$;

commit;
