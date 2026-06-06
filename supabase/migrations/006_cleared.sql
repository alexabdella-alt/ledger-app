-- =====================================================================
-- 006_cleared.sql
-- Marks journal entries as "cleared" (matched to the bank) during a
-- bank reconciliation. journal_entries already has RLS (001), so no new
-- policies are needed — these are additive columns only.
-- Apply in the Supabase SQL editor BEFORE deploying the feature code.
-- =====================================================================

ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS cleared boolean DEFAULT false;
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS cleared_at timestamptz;
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS reconciliation_id uuid REFERENCES public.reconciliations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS journal_entries_reconciliation_idx ON public.journal_entries (reconciliation_id);
