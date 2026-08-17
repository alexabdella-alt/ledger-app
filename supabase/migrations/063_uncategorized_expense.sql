-- =====================================================================
-- 063_uncategorized_expense.sql  (O88 calibration — C200, build surface 1)
--
-- Adds `7150 Uncategorized Expense` (system_role 'uncategorized_expense'):
-- the HONEST SUSPENSE account the calibration spec's Rule 2 requires. A bank
-- line whose vendor is a STRANGER — no attested history, no census entry, no
-- directory hit — books here rather than to a guessed account, at any amount.
--
-- WHY NOT REUSE `7100 Miscellaneous Expense`: ROADMAP §0 TIER 1 #7 carries the
-- acceptance test "Miscellaneous fallback on a recognizable vendor is a hard
-- fail". Miscellaneous means "we looked and it is genuinely miscellaneous";
-- Uncategorized means "we did not know". Collapsing them would delete that
-- test's meaning.
--
-- ── PROVENANCE — READ THIS BEFORE EDITING ────────────────────────────────
-- The function below is a VERBATIM copy of the LIVE definition, taken from
-- `pg_get_functiondef` on 2026-08-17, with EXACTLY ONE LINE ADDED (7150).
-- Diff of live vs this: one `+` line. Nothing else moved.
--
-- The first version of this file was DEFECTIVE and was never applied. It was
-- copied from `009_account_system_roles.sql` — which is not current — and its
-- middle was reconstructed from `src/lib/constants.js` rather than copied. It
-- would have DROPPED 17 accounts from the seed and REPOINTED 11 codes at
-- different accounts (2400 Lease Liability → Notes Payable, 6300 Marketing →
-- Repairs, 3000 Common Stock → Owner Equity), plus role renames (`cogs` →
-- `cost_of_goods_sold`, `rent_occupancy` → `rent`) that would have broken
-- `getAccountByRole` for every new company.
--
-- RULE THIS COST US: a `create or replace` of a live function is a COPY
-- operation, never a reconstruction. The repo holds FIVE definitions of this
-- function (000, 008, 009, 038, 044) and the highest-numbered one, `044`, does
-- NOT match live either — it inserts an `account_type` column that does not
-- exist on `public.accounts`. Take the body from the database, not the tree.
--
-- NOTE the live column set: (company_id, code, name, category, system_role).
-- No `account_type`. The backfill below matches it exactly, for the same reason.
--
-- NO GRANTS RE-ISSUED. `create or replace function` PRESERVES the existing ACL,
-- and `pg_get_functiondef` does not emit grants — so re-asserting them would be
-- writing a privilege set nobody read first. The VERIFY block checks the ACL is
-- unchanged instead.
--
-- NOTHING BOOKS HERE YET. C200 is foundations only: no caller resolves this
-- role and the calibration ladder is not wired.
--
-- Apply after `061`. `062` (unknown_documents policy dedup) is NOT a prerequisite.
-- Idempotent; safe to re-run.
-- =====================================================================
begin;

-- ── (1) SEED — new companies get 7150 at creation ───────────────────────
CREATE OR REPLACE FUNCTION public.seed_company_accounts(p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    ('2101','Payroll Taxes Payable','Liabilities','payroll_taxes_payable'),
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
    ('7150','Uncategorized Expense','Expenses','uncategorized_expense'),
    ('8000','Interest Expense','Expenses','interest_expense'),
    ('8100','Income Tax Expense','Expenses','income_tax_expense'),
    ('8200','Gain / Loss on Asset Disposal','Expenses','gain_loss_disposal')
  ) as v(code, name, category, role)
  on conflict (company_id, code) do update
    set system_role = coalesce(public.accounts.system_role, excluded.system_role);
end;
$function$;


-- ── (2) BACKFILL — every EXISTING company gets 7150 ─────────────────────
-- The seed only runs at company creation, so live companies would never see the
-- new account. Insert-where-absent, scoped by code: a company that already has a
-- 7150 for its own reasons is left exactly as it is. Column set matches the live
-- seed exactly — no `account_type` (the column does not exist), no `is_system`
-- (the seed does not set it, so the table default stands).
insert into public.accounts (company_id, code, name, category, system_role)
select c.id, '7150', 'Uncategorized Expense', 'Expenses', 'uncategorized_expense'
from public.companies c
where not exists (
  select 1 from public.accounts a
  where a.company_id = c.id and a.code = '7150'
);

commit;

-- =====================================================================
-- VERIFY (read-only; run after applying and paste the output into the report,
-- per §6 "apply AND verify in the SAME task").
--
--   -- (a) every company has it, and the role is set
--   select count(*)                                                        as companies,
--          count(*) filter (where a.id is not null)                        as with_7150,
--          count(*) filter (where a.system_role = 'uncategorized_expense') as with_role
--   from public.companies c
--   left join public.accounts a on a.company_id = c.id and a.code = '7150';
--   -- expect: companies = with_7150 = with_role
--
--   -- (b) the seed gained 7150 and LOST NOTHING. These four are exactly what the
--   --     defective first draft would have destroyed — check them by name, not by
--   --     a row count, so the assertion says what it means.
--   select position('uncategorized_expense'   in prosrc) > 0 as has_7150_new,
--          position('lease_liability_current' in prosrc) > 0 as kept_2400_lease,
--          position('marketing_advertising'   in prosrc) > 0 as kept_6300_marketing,
--          position('common_stock'            in prosrc) > 0 as kept_3000_common_stock,
--          position('account_type'            in prosrc) = 0 as no_account_type_column
--   from pg_proc where proname = 'seed_company_accounts';
--   -- expect: all five TRUE
--
--   -- (c) NOTHING has booked here — C200 wires no caller
--   select count(*) as lines_booked_to_7150
--   from public.journal_entry_lines l
--   join public.accounts a on a.id = l.account_id
--   where a.code = '7150';
--   -- expect: 0
--
--   -- (d) the ACL was preserved by create-or-replace
--   select proacl::text from pg_proc where proname = 'seed_company_accounts';
--   -- expect: unchanged from before the apply (execute granted to authenticated)
-- =====================================================================
