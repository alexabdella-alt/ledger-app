-- 046_company_aliases.sql
-- O75: store the company's self-identity aliases / DBA names (comma-separated) so the
-- doc pipeline can tell the company's OWN outgoing invoices (revenue/AR) from vendor
-- bills it received (expense/AP). The company's legal `name` already exists and is the
-- primary anchor; this adds the optional aliases. Idempotent; safe to re-run.
--
-- Until this is applied, aliases simply don't persist (the app writes them in a guarded
-- call that degrades silently) — direction classification still works off the legal name.

begin;

alter table public.companies add column if not exists aliases text;

commit;
