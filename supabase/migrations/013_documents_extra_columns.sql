-- =====================================================================
-- 013_documents_extra_columns.sql
-- Adds optional metadata columns to public.documents so the app can persist
-- tags, the AI's explanation/entry summary, and the linked invoice id.
-- Additive and idempotent — safe to re-run.
-- =====================================================================

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS tags jsonb DEFAULT '[]';
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS ai_explanation text;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS entry_summary text;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS linked_invoice_id text;
