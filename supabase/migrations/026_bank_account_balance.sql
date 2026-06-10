-- =====================================================================
-- 026_bank_account_balance.sql
-- Current cash balance per bank account. Drives the dashboard cash figure
-- (sum across accounts) and is auto-updated to the statement ending balance
-- when a bank statement is reconciled.
-- =====================================================================

alter table public.bank_accounts
  add column if not exists current_balance numeric default 0;
