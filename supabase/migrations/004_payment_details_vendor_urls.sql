-- =====================================================================
-- 004_payment_details_vendor_urls.sql
-- Extra fields for the simplified payment flow + vendor payment links.
--   journal_entries: payment reference/check number and a free-text note
--   contacts:        vendor website + dedicated payment-portal URL
--
-- RLS already covers both tables (001). The app writes these in a separate
-- update / falls back gracefully if the columns are not present yet.
-- =====================================================================

alter table public.journal_entries add column if not exists payment_reference text;
alter table public.journal_entries add column if not exists payment_notes     text;

alter table public.contacts add column if not exists website     text;
alter table public.contacts add column if not exists payment_url text;
