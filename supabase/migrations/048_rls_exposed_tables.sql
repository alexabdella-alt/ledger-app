-- 048_rls_exposed_tables.sql — O21: close the rls_disabled_in_public exposure.
--
-- The live verification query (pg_class.relrowsecurity) found FOUR public tables with RLS
-- DISABLED — each already HAS tenant-isolation policies, but RLS was never enabled, so the
-- policies were INERT and the tables were readable/writable by anyone with the anon key:
--     ap_invoices, opening_balances, payroll_imports, reconciliation_items
-- (All hold company-scoped financial data. Live had drifted from the migration files —
--  the §11 caveat: absence/presence in the repo does not imply live state.)
--
-- Fix, grouped by risk. Idempotent + self-guarded. Apply in the Supabase SQL editor, then
-- re-run the verification query to confirm 0 public tables have rls_enabled = false.
--
--   Verify after:
--     select c.relname, c.relrowsecurity as rls_enabled
--     from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
--     where c.relkind='r' and c.relrowsecurity = false;   -- expect ZERO rows

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- A) ap_invoices — DEAD SCHEMA → DROP (removes the exposure entirely; cleanest).
--    Zero app code references it (grep of src/ finds none; payables book to
--    journal_entries). This supersedes 045_drop_ap_invoices.sql (which was written but
--    never applied). SELF-GUARDED: aborts if the table has ANY rows, so it can never
--    silently destroy data. The dead `ap_aging` view reads from it → drop the view first.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare n bigint;
begin
  if to_regclass('public.ap_invoices') is null then
    raise notice 'ap_invoices already absent — skipping.';
  else
    select count(*) into n from public.ap_invoices;
    if n > 0 then
      raise exception 'ap_invoices has % row(s) — NOT dropping. Investigate first (believed orphaned/empty); if the rows are real, enable RLS on it instead of dropping.', n;
    end if;
    drop view if exists public.ap_aging;
    drop table public.ap_invoices;
    raise notice 'Dropped orphaned ap_invoices (+ dead ap_aging view).';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- B) CRITICAL — opening_balances (opening trial balance / starting position).
--    Policies ob_select / ob_insert / ob_update already exist and are correct tenant
--    isolation (company_id = ANY(auth_company_ids()) + owner/admin/accountant for writes).
--    Enabling RLS activates them. ALSO add the MISSING ob_delete policy — the app deletes
--    opening_balances on edit (App.jsx: the reverse/replace flow), which would silently fail
--    under RLS with no delete policy.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.opening_balances enable row level security;

drop policy if exists ob_delete on public.opening_balances;
create policy ob_delete on public.opening_balances for delete
  using ( (company_id = any (public.auth_company_ids()))
      and (public.auth_company_role(company_id) = any (array['owner','admin','accountant'])) );

-- ─────────────────────────────────────────────────────────────────────────────
-- C) CRITICAL — payroll_imports (payroll register imports; sensitive figures).
--    Policies payroll_select / payroll_insert / payroll_update already exist and are correct.
--    (No delete policy needed — the app never deletes payroll_imports; verified.)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.payroll_imports enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- D) LOW — reconciliation_items (dead schema §11, but a real company-linked table).
--    Policies recon_items_select / recon_items_insert / recon_items_delete already exist
--    (isolated via the parent reconciliation's company_id). Enable RLS to activate them.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.reconciliation_items enable row level security;

commit;
