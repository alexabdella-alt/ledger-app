-- =====================================================================
-- 008_seed_coa_v2.sql
-- Re-seeds public.seed_company_accounts() with the authoritative chart of
-- accounts (the 6xxx/7xxx/8xxx operating-expense scheme). Idempotent upsert
-- keyed on (company_id, code) so it can be re-run to fix existing companies.
--
-- VERIFY BEFORE RUNNING: confirm your public.accounts table columns are
-- (company_id, code, name, category). If it also has account_type, the
-- function sets it to lower(category); drop that line if the column doesn't
-- exist. Requires a UNIQUE constraint/index on (company_id, code).
-- =====================================================================

create or replace function public.seed_company_accounts(p_company_id uuid)
returns void language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
  if not public.is_company_member(p_company_id) then
    raise exception 'not a member of company %', p_company_id;
  end if;

  insert into public.accounts (company_id, code, name, category, account_type)
  select p_company_id, v.code, v.name, v.category, lower(v.category)
  from (values
    ('1000', 'Cash & Cash Equivalents', 'Assets'),
    ('1010', 'Savings Account', 'Assets'),
    ('1100', 'Accounts Receivable', 'Assets'),
    ('1250', 'Allowance for Doubtful Accounts', 'Assets'),
    ('1300', 'Prepaid Expenses', 'Assets'),
    ('1400', 'Inventory', 'Assets'),
    ('1410', 'Other Current Assets', 'Assets'),
    ('1500', 'Fixed Assets (Equipment & Furniture)', 'Assets'),
    ('1510', 'Accumulated Depreciation', 'Assets'),
    ('1600', 'Intangible Assets', 'Assets'),
    ('1700', 'Security Deposits', 'Assets'),
    ('1800', 'Right-of-Use Asset (ASC 842)', 'Assets'),
    ('1810', 'Accumulated Amortization - ROU', 'Assets'),
    ('2000', 'Accounts Payable', 'Liabilities'),
    ('2100', 'Accrued Liabilities', 'Liabilities'),
    ('2200', 'Credit Card Liability', 'Liabilities'),
    ('2300', 'Deferred Revenue', 'Liabilities'),
    ('2350', 'Sales Tax Payable', 'Liabilities'),
    ('2400', 'Lease Liability - Current (ASC 842)', 'Liabilities'),
    ('2450', 'Lease Liability - Non-Current (ASC 842)', 'Liabilities'),
    ('2500', 'Long-Term Debt', 'Liabilities'),
    ('2600', 'Notes Payable', 'Liabilities'),
    ('3000', 'Common Stock', 'Equity'),
    ('3100', 'Retained Earnings', 'Equity'),
    ('3200', 'Additional Paid-In Capital', 'Equity'),
    ('3300', 'Owner''s Draw / Distributions', 'Equity'),
    ('4000', 'Product Revenue', 'Revenue'),
    ('4100', 'Service Revenue', 'Revenue'),
    ('4200', 'Subscription Revenue', 'Revenue'),
    ('4300', 'Interest Income', 'Revenue'),
    ('4400', 'Other Income', 'Revenue'),
    ('5000', 'Cost of Goods Sold', 'Expenses'),
    ('5100', 'Direct Labor', 'Expenses'),
    ('5200', 'Shipping & Fulfillment', 'Expenses'),
    ('6000', 'Salaries & Wages', 'Expenses'),
    ('6010', 'Payroll Tax Expense', 'Expenses'),
    ('6020', 'Employee Benefits', 'Expenses'),
    ('6050', 'ROU Asset Amortization', 'Expenses'),
    ('6100', 'Rent & Occupancy', 'Expenses'),
    ('6150', 'Operating Lease Expense (ASC 842)', 'Expenses'),
    ('6200', 'Utilities', 'Expenses'),
    ('6250', 'Repairs & Maintenance', 'Expenses'),
    ('6300', 'Marketing & Advertising', 'Expenses'),
    ('6400', 'Travel & Entertainment', 'Expenses'),
    ('6500', 'Technology & Software (SaaS)', 'Expenses'),
    ('6600', 'Office Supplies & De Minimis Equipment', 'Expenses'),
    ('6700', 'Insurance', 'Expenses'),
    ('6800', 'Professional Services (Legal/Accounting)', 'Expenses'),
    ('6900', 'Depreciation & Amortization', 'Expenses'),
    ('7000', 'Bad Debt Expense', 'Expenses'),
    ('7100', 'Miscellaneous Expense', 'Expenses'),
    ('8000', 'Interest Expense', 'Expenses'),
    ('8100', 'Income Tax Expense', 'Expenses'),
    ('8200', 'Gain / Loss on Asset Disposal', 'Expenses')
  ) as v(code, name, category)
  on conflict (company_id, code) do update
    set name = excluded.name,
        category = excluded.category,
        account_type = excluded.account_type;
end;
$fn$;

revoke all on function public.seed_company_accounts(uuid) from public;
grant execute on function public.seed_company_accounts(uuid) to authenticated;

-- To realign an EXISTING company's accounts to the new scheme, run:
--   select public.seed_company_accounts('<company_id>');
-- Note: this updates names/categories for matching codes and inserts any
-- missing ones. It does NOT delete old-scheme codes that are no longer in the
-- chart (e.g. a stale 5300 Utilities) — remove those manually if present.
