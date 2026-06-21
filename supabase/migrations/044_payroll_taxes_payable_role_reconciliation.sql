-- =====================================================================
-- 044_payroll_taxes_payable_role_reconciliation.sql  (Tier-1 COA reconciliation)
--
-- Per-company COA divergence (companies seeded by different COA versions over time;
-- migration 009 set roles by v2 code only, leaving v1-era accounts role-NULL) left
-- payroll roles unresolvable for some companies. This converges the PAYROLL roles
-- ONLY (Tier-1); a broader COA-normalization is a separate, deliberate pass (Tier-2).
--
-- Builder resolves by ROLE, not code, so we set roles — we do NOT renumber accounts
-- (renumbering rows with posted journal_entry_lines is unsafe; that's Tier-2).
--
-- Converges on code 2101 for Payroll Taxes Payable (3 companies already had it).
-- Every step is gated on "no account already holds that role for that company", so it
-- is idempotent AND safe against accounts_company_system_role_uq — the partial unique
-- index UNIQUE (company_id, system_role) WHERE system_role IS NOT NULL (≤1 acct/role/co).
-- Idempotent / re-runnable. Next free: 045.
-- =====================================================================
begin;

-- ── A) payroll_taxes_payable ──────────────────────────────────────────────────
-- A1. Adopt an existing (role-NULL) 2101 where one exists and the role is free.
update public.accounts a
   set system_role = 'payroll_taxes_payable'
 where a.code = '2101'
   and a.system_role is null
   and not exists (select 1 from public.accounts b
                    where b.company_id = a.company_id
                      and b.system_role = 'payroll_taxes_payable');

-- A2. Create a 2101 Payroll Taxes Payable for any company that still lacks the role.
insert into public.accounts (company_id, code, name, category, system_role)
select c.id, '2101', 'Payroll Taxes Payable', 'Liabilities', 'payroll_taxes_payable'
  from public.companies c
 where not exists (select 1 from public.accounts b
                    where b.company_id = c.id
                      and b.system_role = 'payroll_taxes_payable')
on conflict (company_id, code) do nothing;   -- code-collision safety; A1 already adopted any 2101

-- ── B) payroll_tax ────────────────────────────────────────────────────────────
-- Adopt a vestigial 5101 ONLY where the company has no payroll_tax role yet (so we
-- never collide with an existing 6010:payroll_tax — e.g. Test 1's 5101 stays NULL).
update public.accounts a
   set system_role = 'payroll_tax'
 where a.code = '5101'
   and a.system_role is null
   and not exists (select 1 from public.accounts b
                    where b.company_id = a.company_id
                      and b.system_role = 'payroll_tax');

-- ── C) Canonical seed: new companies get 2101 Payroll Taxes Payable ───────────
-- (036 body verbatim + the one new 2101 row after 2100; converge on 2101, not 2150.)
CREATE OR REPLACE FUNCTION public.seed_company_accounts(p_company_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
begin
  if not public.is_company_member(p_company_id) then
    raise exception 'not a member of company %', p_company_id;
  end if;
  insert into public.accounts (company_id, code, name, category, system_role)
  select p_company_id, v.code, v.name, v.category, v.role
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
    ('2101','Payroll Taxes Payable','Liabilities','payroll_taxes_payable'),  -- NEW (converge on 2101)
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
$$;
revoke all on function public.seed_company_accounts(uuid) from public;
grant execute on function public.seed_company_accounts(uuid) to authenticated;

commit;
