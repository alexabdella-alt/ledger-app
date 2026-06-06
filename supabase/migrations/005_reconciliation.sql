-- =====================================================================
-- 005_reconciliation.sql
-- Bank reconciliation sessions ("Match your bank statement").
-- Stores in-progress + completed matches so a session survives refresh.
--
-- NOTE: requested as "003_reconciliation.sql" but 003/004 are already
-- taken (003_ap_workflow, 004_payment_details_vendor_urls) — numbered 005
-- to preserve apply order. RLS uses public.is_company_member (from 001).
-- Apply this in the Supabase SQL editor BEFORE deploying the feature code.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.reconciliations (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.bank_accounts(id),
  account_name text,
  period_start date NOT NULL,
  period_end date NOT NULL,
  statement_balance numeric NOT NULL,
  books_balance numeric,
  difference numeric,
  status text DEFAULT 'in_progress',
  matched_transactions jsonb DEFAULT '[]',
  unmatched_bank jsonb DEFAULT '[]',
  unmatched_books jsonb DEFAULT '[]',
  added_during_reconciliation jsonb DEFAULT '[]',
  completed_at timestamptz,
  completed_by text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reconciliations_company_idx ON public.reconciliations (company_id, status);

ALTER TABLE public.reconciliations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reconciliations_select ON public.reconciliations;
CREATE POLICY reconciliations_select ON public.reconciliations FOR SELECT TO authenticated USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS reconciliations_insert ON public.reconciliations;
CREATE POLICY reconciliations_insert ON public.reconciliations FOR INSERT TO authenticated WITH CHECK (public.is_company_member(company_id));

DROP POLICY IF EXISTS reconciliations_update ON public.reconciliations;
CREATE POLICY reconciliations_update ON public.reconciliations FOR UPDATE TO authenticated USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));

DROP POLICY IF EXISTS reconciliations_delete ON public.reconciliations;
CREATE POLICY reconciliations_delete ON public.reconciliations FOR DELETE TO authenticated USING (public.is_company_member(company_id));
