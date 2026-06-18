-- =====================================================================
-- 034_reconcile_contacts_payment_url.sql
-- Schema-drift fix found in the full information_schema audit: contacts.payment_url
-- is written by persistContact (App.jsx) and read by ApView's vendor pay-link,
-- but migration 004 (which declared it) only partially landed — the column was
-- absent on the live database. Its absence tripped persistContact's column-error
-- fallback, which then dropped the ENTIRE `extra` block, silently failing to
-- persist website / business_type / ein_ssn / mailing_address / is_1099_exempt /
-- sent_1099_2025 / vendor_account_number / tax_id (all of which DO exist).
-- Idempotent; safe on any database (no-op where the column already exists).
-- =====================================================================
begin;

alter table public.contacts add column if not exists payment_url text;

commit;
