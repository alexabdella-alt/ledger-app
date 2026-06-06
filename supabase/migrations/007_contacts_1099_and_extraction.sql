-- =====================================================================
-- 007_contacts_1099_and_extraction.sql
-- Adds 1099 tracking + richer auto-extracted fields to contacts.
-- contacts already has RLS (001) — these are additive columns only.
-- Apply in the Supabase SQL editor BEFORE deploying the feature code.
-- =====================================================================

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS business_type text;          -- individual | sole_prop | smllc | partnership | corp | scorp | nonprofit
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS ein_ssn text;                -- SSN or EIN (for 1099 filing)
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS mailing_address text;        -- where to mail the form
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS is_1099_exempt boolean DEFAULT false;  -- corp / s-corp / nonprofit
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS sent_1099_2025 boolean DEFAULT false;  -- marked as sent for tax year 2025
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS vendor_account_number text;  -- our account # with the vendor
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS payment_terms text;          -- e.g. Net 30 (no-op if already present)
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS tax_id text;                 -- alias collected during extraction
