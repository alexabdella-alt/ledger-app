-- =====================================================================
-- 068_seed_gap_roles.sql  (O108 finding 3 + the 6520/6530 decision)
--
-- Closes the seed gap: three accounts that exist on live client charts but were
-- in NO chart definition the seed knew about, and therefore carry
-- `system_role IS NULL` — invisible to every `getAccountByRole` lookup forever.
--
--   3400  Opening Balance Equity   → opening_balance_equity
--   6520  Merchant Processing Fees → merchant_processing_fees
--   6530  Bank Service Charges     → bank_service_charges
--
-- ── WHERE THESE CAME FROM (established 2026-08-17, live evidence) ────────
-- `3400` is a SEEDING OMISSION: it has always been in `src/lib/constants.js` with a
-- defined role and was simply never in the seed, so it is materialised on demand at
-- the first opening-balance post (`App.jsx ensureAccountIdForCode`).
--
-- `6520`/`6530` came from a HUMAN CORRECTION, not from machine invention. Jan 28
-- Toast booked at confidence 85 with reasoning arguing for `6500`; Jan 31 bank fee at
-- 70, hedging `8000` vs `7100`, flagged needs-review. The CPA recategorised both.
-- `persistRecode` UPDATES the line's `account_id` IN PLACE and creates the target
-- account first if absent — which is why those entries still carry reasoning that
-- contradicts the account they sit in, and why the accounts exist at all. From Feb 25
-- the AI proposed `6520` directly at confidence 99 (the learned-mapping stamp), so the
-- learning loop worked exactly as designed. **The defect was never the accounts — it
-- was that creating two permanent accounts on a client's chart left no trace.** They
-- describe real recurring costs for a restaurant client and were chosen by a CPA, so
-- they are BLESSED as canonical here rather than reclassified.
--
-- ── PROVENANCE ──────────────────────────────────────────────────────────
-- The function below is a VERBATIM copy of the LIVE definition, re-pulled from
-- `pg_get_functiondef` on 2026-08-17 AFTER `063` was applied, with EXACTLY THREE
-- LINES ADDED. Proven mechanically, not by eye: both bodies written to files,
-- `diff -u` shows three `+` lines and nothing else. 56 → 59 rows.
--
-- Cross-check performed and passed: the fresh pull was byte-identical to the body
-- `063` installed, which independently confirms `063` applied faithfully and that the
-- paste was complete rather than truncated.
--
-- Per the §6 standing rule (recorded after `063` was first written wrong): a
-- `create or replace` of a live function is a COPY operation, never a reconstruction.
--
-- NO GRANTS RE-ISSUED — `create or replace` preserves the ACL, and the ACL is a
-- separate matter handled by `069`.
--
-- Apply after `063`. Idempotent; safe to re-run.
-- =====================================================================
begin;

-- ── (1) SEED — new companies get all three, with roles ──────────────────
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
    ('3400','Opening Balance Equity','Equity','opening_balance_equity'),
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
    ('6520','Merchant Processing Fees','Expenses','merchant_processing_fees'),
    ('6530','Bank Service Charges','Expenses','bank_service_charges'),
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


-- ── (2) ROLE BACKFILL — existing rows only, never overwriting ───────────
-- Sets the role on rows that ALREADY EXIST and are role-less. Keyed on `code` AND
-- `system_role IS NULL`, so a company that has deliberately assigned one of these
-- codes a different role is untouched. This is the direct repair of the O108
-- fingerprint: after this runs, `system_role IS NULL` should again mean "invented at
-- runtime and not yet blessed", which is what makes the standing detector useful.
--
-- DELIBERATELY DOES NOT CREATE ROWS. The seed above handles new companies; creating
-- `6520`/`6530` on every existing company would add merchant-processing and
-- bank-service accounts to charts that have never used them. `3400` is the arguable
-- exception — see the OPEN QUESTION below; not decided here, so not done here.
update public.accounts set system_role = 'opening_balance_equity'
 where code = '3400' and system_role is null;

update public.accounts set system_role = 'merchant_processing_fees'
 where code = '6520' and system_role is null;

update public.accounts set system_role = 'bank_service_charges'
 where code = '6530' and system_role is null;

commit;

-- =====================================================================
-- OPEN QUESTION, deliberately NOT resolved by this migration:
--   Should `3400` be CREATED on existing companies that lack it (as `063` did for
--   `7150`), or left to materialise on demand? It is canonical and every company will
--   eventually need one — but creating it early puts an unused equity account on
--   charts, and the on-demand path has worked for months. Operator's call; a
--   three-line follow-up either way.
--
-- VERIFY (read-only; paste the output into the report, per §6):
--
--   -- (a) all three roles are now set wherever the codes exist
--   select code, count(*) as rows,
--          count(*) filter (where system_role is not null) as with_role,
--          min(system_role) as role
--   from public.accounts where code in ('3400','6520','6530')
--   group by code order by code;
--   -- expect: rows = with_role for each; roles as named above
--
--   -- (b) THE FINGERPRINT IS CLEAN — no role-less accounts left anywhere
--   select company_id, code, name, created_at from public.accounts
--   where system_role is null order by created_at;
--   -- expect: 0 rows. Any row here after this migration is a NEW runtime
--   -- materialisation and should have an `account_materialized` audit entry to match.
--
--   -- (c) the seed carries all three for the next new company, and lost nothing
--   select position('opening_balance_equity'  in prosrc) > 0 as has_3400,
--          position('merchant_processing_fees' in prosrc) > 0 as has_6520,
--          position('bank_service_charges'     in prosrc) > 0 as has_6530,
--          position('uncategorized_expense'    in prosrc) > 0 as kept_7150,
--          position('lease_liability_current'  in prosrc) > 0 as kept_2400,
--          position('marketing_advertising'    in prosrc) > 0 as kept_6300
--   from pg_proc where proname = 'seed_company_accounts';
--   -- expect: all six TRUE
--
--   -- (d) nothing MOVED — the booked lines on these accounts are untouched
--   select a.code, count(*) filter (where je.deleted_at is null) as live_lines
--   from public.accounts a
--   join public.journal_entry_lines l on l.account_id = a.id
--   join public.journal_entries je on je.id = l.journal_entry_id
--   where a.code in ('3400','6520','6530') group by a.code order by a.code;
--   -- expect: 3400 = 1, 6520 = 3, 6530 = 2  (unchanged from 2026-08-17)
-- =====================================================================
