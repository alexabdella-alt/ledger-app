-- =====================================================================
-- 009_account_system_roles.sql
-- Make accounts user-customizable (QuickBooks-style) while keeping app logic
-- stable. Each default/system account carries a permanent system_role slug;
-- the app references roles, never hardcoded codes. Custom accounts added by a
-- user have system_role = NULL (fully renamable/renumberable/deletable).
--
-- VERIFY: public.accounts has columns (company_id, code, name, category,
-- account_type) and a UNIQUE (company_id, code). Adjust if your schema differs.
-- =====================================================================

-- 1. Stable role identifier (NULL = user-created custom account).
alter table public.accounts add column if not exists system_role text;

-- 2. Backfill existing companies by matching on their (authoritative) codes.
update public.accounts a
set system_role = m.role
from (values
    ('1000','cash'),
    ('1010','savings'),
    ('1100','accounts_receivable'),
    ('1250','allowance_doubtful_accounts'),
    ('1300','prepaid_expenses'),
    ('1400','inventory'),
    ('1410','other_current_assets'),
    ('1500','fixed_assets'),
    ('1510','accumulated_depreciation'),
    ('1600','intangible_assets'),
    ('1700','security_deposits'),
    ('1800','rou_asset'),
    ('1810','accumulated_amortization_rou'),
    ('2000','accounts_payable'),
    ('2100','accrued_liabilities'),
    ('2200','credit_card_liability'),
    ('2300','deferred_revenue'),
    ('2350','sales_tax_payable'),
    ('2400','lease_liability_current'),
    ('2450','lease_liability_noncurrent'),
    ('2500','long_term_debt'),
    ('2600','notes_payable'),
    ('3000','common_stock'),
    ('3100','retained_earnings'),
    ('3200','additional_paid_in_capital'),
    ('3300','owners_draw'),
    ('4000','product_revenue'),
    ('4100','service_revenue'),
    ('4200','subscription_revenue'),
    ('4300','interest_income'),
    ('4400','other_income'),
    ('5000','cogs'),
    ('5100','direct_labor'),
    ('5200','shipping_fulfillment'),
    ('6000','salaries_wages'),
    ('6010','payroll_tax'),
    ('6020','employee_benefits'),
    ('6050','rou_amortization'),
    ('6100','rent_occupancy'),
    ('6150','operating_lease_expense'),
    ('6200','utilities'),
    ('6250','repairs_maintenance'),
    ('6300','marketing_advertising'),
    ('6400','travel_entertainment'),
    ('6500','technology_software'),
    ('6600','office_supplies'),
    ('6700','insurance'),
    ('6800','professional_services'),
    ('6900','depreciation_amortization'),
    ('7000','bad_debt'),
    ('7100','miscellaneous_expense'),
    ('8000','interest_expense'),
    ('8100','income_tax_expense'),
    ('8200','gain_loss_disposal')
) as m(code, role)
where a.code = m.code and a.system_role is null;

-- 3. At most one account per role per company (custom accounts excluded via WHERE).
create unique index if not exists accounts_company_system_role_uq
  on public.accounts (company_id, system_role)
  where system_role is not null;

-- 4. Re-seed function: assigns system_role to every default account. Inserts
--    missing accounts; for existing rows it only fills a missing role and does
--    NOT overwrite a user's renamed name/code/category.
create or replace function public.seed_company_accounts(p_company_id uuid)
returns void language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
  if not public.is_company_member(p_company_id) then
    raise exception 'not a member of company %', p_company_id;
  end if;

  insert into public.accounts (company_id, code, name, category, account_type, system_role)
  select p_company_id, v.code, v.name, v.category, lower(v.category), v.role
  from (values
    ('1000','Cash & Cash Equivalents','Assets','cash'),
    ('1010','Savings Account','Assets','savings'),
    ('1100','Accounts Receivable','Assets','accounts_receivable'),
    ('1250','Allowance for Doubtful Accounts','Assets','allowance_doubtful_accounts'),
    ('1300','Prepaid Expenses','Assets','prepaid_expenses'),
    ('1400','Inventory','Assets','inventory'),
    ('1410','Other Current Assets','Assets','other_current_assets'),
    ('1500','Fixed Assets (Equipment & Furniture)','Assets','fixed_assets'),
    ('1510','Accumulated Depreciation','Assets','accumulated_depreciation'),
    ('1600','Intangible Assets','Assets','intangible_assets'),
    ('1700','Security Deposits','Assets','security_deposits'),
    ('1800','Right-of-Use Asset (ASC 842)','Assets','rou_asset'),
    ('1810','Accumulated Amortization - ROU','Assets','accumulated_amortization_rou'),
    ('2000','Accounts Payable','Liabilities','accounts_payable'),
    ('2100','Accrued Liabilities','Liabilities','accrued_liabilities'),
    ('2200','Credit Card Liability','Liabilities','credit_card_liability'),
    ('2300','Deferred Revenue','Liabilities','deferred_revenue'),
    ('2350','Sales Tax Payable','Liabilities','sales_tax_payable'),
    ('2400','Lease Liability - Current (ASC 842)','Liabilities','lease_liability_current'),
    ('2450','Lease Liability - Non-Current (ASC 842)','Liabilities','lease_liability_noncurrent'),
    ('2500','Long-Term Debt','Liabilities','long_term_debt'),
    ('2600','Notes Payable','Liabilities','notes_payable'),
    ('3000','Common Stock','Equity','common_stock'),
    ('3100','Retained Earnings','Equity','retained_earnings'),
    ('3200','Additional Paid-In Capital','Equity','additional_paid_in_capital'),
    ('3300','Owner''s Draw / Distributions','Equity','owners_draw'),
    ('4000','Product Revenue','Revenue','product_revenue'),
    ('4100','Service Revenue','Revenue','service_revenue'),
    ('4200','Subscription Revenue','Revenue','subscription_revenue'),
    ('4300','Interest Income','Revenue','interest_income'),
    ('4400','Other Income','Revenue','other_income'),
    ('5000','Cost of Goods Sold','Expenses','cogs'),
    ('5100','Direct Labor','Expenses','direct_labor'),
    ('5200','Shipping & Fulfillment','Expenses','shipping_fulfillment'),
    ('6000','Salaries & Wages','Expenses','salaries_wages'),
    ('6010','Payroll Tax Expense','Expenses','payroll_tax'),
    ('6020','Employee Benefits','Expenses','employee_benefits'),
    ('6050','ROU Asset Amortization','Expenses','rou_amortization'),
    ('6100','Rent & Occupancy','Expenses','rent_occupancy'),
    ('6150','Operating Lease Expense (ASC 842)','Expenses','operating_lease_expense'),
    ('6200','Utilities','Expenses','utilities'),
    ('6250','Repairs & Maintenance','Expenses','repairs_maintenance'),
    ('6300','Marketing & Advertising','Expenses','marketing_advertising'),
    ('6400','Travel & Entertainment','Expenses','travel_entertainment'),
    ('6500','Technology & Software (SaaS)','Expenses','technology_software'),
    ('6600','Office Supplies & De Minimis Equipment','Expenses','office_supplies'),
    ('6700','Insurance','Expenses','insurance'),
    ('6800','Professional Services (Legal/Accounting)','Expenses','professional_services'),
    ('6900','Depreciation & Amortization','Expenses','depreciation_amortization'),
    ('7000','Bad Debt Expense','Expenses','bad_debt'),
    ('7100','Miscellaneous Expense','Expenses','miscellaneous_expense'),
    ('8000','Interest Expense','Expenses','interest_expense'),
    ('8100','Income Tax Expense','Expenses','income_tax_expense'),
    ('8200','Gain / Loss on Asset Disposal','Expenses','gain_loss_disposal')
  ) as v(code, name, category, role)
  on conflict (company_id, code) do update
    set system_role = coalesce(public.accounts.system_role, excluded.system_role);
end;
$fn$;

revoke all on function public.seed_company_accounts(uuid) from public;
grant execute on function public.seed_company_accounts(uuid) to authenticated;

-- 5. (Optional but recommended) Guard against deleting a system account or an
--    account that still has journal lines. Enforced in the app too, but a DB
--    trigger makes it airtight. Uncomment if your lines table is named
--    journal_entry_lines with an account_id FK.
--
-- create or replace function public.prevent_protected_account_delete()
-- returns trigger language plpgsql as $g$
-- begin
--   if old.system_role is not null then
--     raise exception 'Account % is a system account and cannot be deleted (rename it instead).', old.code;
--   end if;
--   if exists (select 1 from public.journal_entry_lines l where l.account_id = old.id) then
--     raise exception 'Account % has transactions and cannot be deleted.', old.code;
--   end if;
--   return old;
-- end;
-- $g$;
-- drop trigger if exists trg_prevent_protected_account_delete on public.accounts;
-- create trigger trg_prevent_protected_account_delete
--   before delete on public.accounts
--   for each row execute function public.prevent_protected_account_delete();
