-- =====================================================================
-- 063_uncategorized_expense.sql  (O88 calibration — C200, build surface 1)
--
-- Adds `7150 Uncategorized Expense` (system_role 'uncategorized_expense'):
-- the HONEST SUSPENSE account the calibration spec's Rule 2 requires. A
-- bank line whose vendor is a STRANGER — no attested history, no census
-- entry, no directory hit — books here rather than to a guessed account,
-- at any dollar amount.
--
-- WHY NOT REUSE `7100 Miscellaneous Expense`: ROADMAP §0 TIER 1 #7 carries
-- the acceptance test "Miscellaneous fallback on a recognizable vendor is a
-- hard fail". Miscellaneous means "we looked and it is genuinely
-- miscellaneous"; Uncategorized means "we did not know". Collapsing the two
-- would delete that test's meaning — a stranger parked in 7100 would be
-- indistinguishable from the exact failure the test exists to catch.
--
-- NOTHING BOOKS HERE YET. C200 is foundations only: no caller resolves this
-- role, and the calibration ladder is not wired. This migration exists so
-- the account is present and backfilled BEFORE anything depends on it.
--
-- Two parts, both idempotent:
--   (1) re-assert seed_company_accounts() with 7150 included → new companies
--   (2) backfill every EXISTING company that lacks it → live companies
--
-- Apply after `061`. `062` is reserved for the unknown_documents policy
-- dedup and is NOT a prerequisite of this file.
-- =====================================================================
begin;

-- ── (1) SEED — new companies get 7150 at creation ───────────────────────
-- Mirrors 009_account_system_roles.sql exactly, plus one row. The ON
-- CONFLICT clause is unchanged: it never overwrites a system_role a company
-- already has, so re-applying this can't rewrite a live chart.
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
    ('1500','Fixed Assets','Assets','fixed_assets'),
    ('1510','Accumulated Depreciation','Assets','accumulated_depreciation'),
    ('2000','Accounts Payable','Liabilities','accounts_payable'),
    ('2050','Accrued Liabilities','Liabilities','accrued_liabilities'),
    ('2100','Payroll Liabilities','Liabilities','payroll_liabilities'),
    ('2101','Payroll Taxes Payable','Liabilities','payroll_taxes_payable'),
    ('2200','Credit Card Payable','Liabilities','credit_card_payable'),
    ('2300','Deferred Revenue','Liabilities','deferred_revenue'),
    ('2350','Sales Tax Payable','Liabilities','sales_tax_payable'),
    ('2400','Notes Payable','Liabilities','notes_payable'),
    ('3000','Owner Equity','Equity','owner_equity'),
    ('3100','Retained Earnings','Equity','retained_earnings'),
    ('3200','Owner Draws','Equity','owner_draws'),
    ('3400','Opening Balance Equity','Equity','opening_balance_equity'),
    ('4000','Sales Revenue','Revenue','sales_revenue'),
    ('4100','Service Revenue','Revenue','service_revenue'),
    ('4900','Other Income','Revenue','other_income'),
    ('5000','Cost of Goods Sold','Expenses','cost_of_goods_sold'),
    ('6000','Salaries & Wages','Expenses','salaries_wages'),
    ('6010','Payroll Tax Expense','Expenses','payroll_tax'),
    ('6100','Rent & Occupancy','Expenses','rent'),
    ('6200','Utilities','Expenses','utilities'),
    ('6300','Repairs & Maintenance','Expenses','repairs_maintenance'),
    ('6400','Travel & Entertainment','Expenses','travel_entertainment'),
    ('6500','Technology & Software','Expenses','technology_software'),
    ('6600','Office Supplies & De Minimis Equipment','Expenses','office_supplies'),
    ('6700','Insurance','Expenses','insurance'),
    ('6800','Professional Services (Legal/Accounting)','Expenses','professional_services'),
    ('6900','Depreciation & Amortization','Expenses','depreciation_amortization'),
    ('7000','Bad Debt Expense','Expenses','bad_debt'),
    ('7100','Miscellaneous Expense','Expenses','miscellaneous_expense'),
    ('7150','Uncategorized Expense','Expenses','uncategorized_expense'),
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

-- ── (2) BACKFILL — every existing company gets 7150 ─────────────────────
-- The seed function only runs at company creation, so live companies would
-- never see the new account. Insert-where-absent, scoped by code: a company
-- that already has a 7150 for its own reasons is left exactly as it is.
insert into public.accounts (company_id, code, name, category, account_type, system_role, is_system)
select c.id, '7150', 'Uncategorized Expense', 'Expenses', 'expenses', 'uncategorized_expense', false
from public.companies c
where not exists (
  select 1 from public.accounts a
  where a.company_id = c.id and a.code = '7150'
);

commit;

-- =====================================================================
-- VERIFY (read-only; run after applying, paste the output into the report
-- per §6 "apply AND verify in the SAME task"):
--
--   -- every company has exactly one, and the role is set
--   select count(*) as companies,
--          count(*) filter (where a.id is not null)              as with_7150,
--          count(*) filter (where a.system_role =
--                           'uncategorized_expense')             as with_role
--   from public.companies c
--   left join public.accounts a
--     on a.company_id = c.id and a.code = '7150';
--   -- expect: companies = with_7150 = with_role
--
--   -- the seed function carries it for the next new company
--   select position('uncategorized_expense' in prosrc) > 0 as seed_has_role
--   from pg_proc where proname = 'seed_company_accounts';
--   -- expect: true
--
--   -- nothing has been booked here yet (C200 wires no caller)
--   select count(*) from public.journal_entry_lines l
--   join public.accounts a on a.id = l.account_id
--   where a.code = '7150';
--   -- expect: 0
-- =====================================================================
