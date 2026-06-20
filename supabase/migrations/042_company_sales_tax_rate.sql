-- =====================================================================
-- 042_company_sales_tax_rate.sql   (Phase A — event #16 Step 2)
-- Saved default blended sales-tax rate per company; pre-fills the per-invoice tax
-- field in Send Invoice (still editable / overridable per invoice). Stored as a
-- percent (e.g. 8.5 = 8.5%). Idempotent. Applied live 2026-06; this file commits it
-- so the migration chain stays reproducible from the repo (§6/§11). Next free: 043.
-- =====================================================================
begin;

alter table public.companies
  add column if not exists sales_tax_rate numeric not null default 0;
comment on column public.companies.sales_tax_rate is
  'Default blended sales-tax rate (percent, e.g. 8.5). Pre-fills the Send Invoice tax field; overridable per invoice.';

commit;
