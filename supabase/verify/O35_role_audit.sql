-- ═══════════════════════════════════════════════════════════════════════════════
-- O35 — WHICH COMPANIES HAVE WHICH ROLES. THE PER-COMPANY AUDIT THE ITEM ASKS FOR.
--
-- Companies were seeded by different chart versions over time, so an older one can hold an
-- account the app cannot FIND: every role-resolved feature (`getAccountByRole`) looks up a
-- `system_role`, and a v1-era account has NULL there. The account is on the balance sheet
-- and invisible to the code — which is why this surfaced through payroll first, and why
-- fixing payroll's roles alone did not close it.
--
-- ★★ THIS IS A REPORT, NOT A FIX, AND THE SPLIT BELOW IS WHY. Setting a role on an existing
-- account is SAFE. Renumbering a code is NOT — journal lines point at accounts, and moving a
-- code without re-pointing them silently re-files history. The two must never be done by the
-- same script, so this names them separately and proposes neither.
--
-- ▶ Read-only. Nothing here writes.
-- ═══════════════════════════════════════════════════════════════════════════════

-- The canonical set, generated from `src/lib/constants.js` so it cannot drift from the app's
-- own idea of what a role is. 59 roles.
with canonical(role, code) as (values
('cash','1000'),
        ('savings','1010'),
        ('accounts_receivable','1100'),
        ('allowance_doubtful_accounts','1250'),
        ('prepaid_expenses','1300'),
        ('inventory','1400'),
        ('other_current_assets','1410'),
        ('fixed_assets','1500'),
        ('accumulated_depreciation','1510'),
        ('intangible_assets','1600'),
        ('security_deposits','1700'),
        ('rou_asset','1800'),
        ('accumulated_amortization_rou','1810'),
        ('accounts_payable','2000'),
        ('accrued_liabilities','2100'),
        ('payroll_taxes_payable','2101'),
        ('credit_card_liability','2200'),
        ('deferred_revenue','2300'),
        ('sales_tax_payable','2350'),
        ('lease_liability_current','2400'),
        ('lease_liability_noncurrent','2450'),
        ('long_term_debt','2500'),
        ('notes_payable','2600'),
        ('common_stock','3000'),
        ('retained_earnings','3100'),
        ('additional_paid_in_capital','3200'),
        ('owners_draw','3300'),
        ('opening_balance_equity','3400'),
        ('product_revenue','4000'),
        ('service_revenue','4100'),
        ('subscription_revenue','4200'),
        ('interest_income','4300'),
        ('other_income','4400'),
        ('cogs','5000'),
        ('direct_labor','5100'),
        ('shipping_fulfillment','5200'),
        ('salaries_wages','6000'),
        ('payroll_tax','6010'),
        ('employee_benefits','6020'),
        ('rou_amortization','6050'),
        ('rent_occupancy','6100'),
        ('operating_lease_expense','6150'),
        ('utilities','6200'),
        ('repairs_maintenance','6250'),
        ('marketing_advertising','6300'),
        ('travel_entertainment','6400'),
        ('technology_software','6500'),
        ('merchant_processing_fees','6520'),
        ('bank_service_charges','6530'),
        ('office_supplies','6600'),
        ('insurance','6700'),
        ('professional_services','6800'),
        ('depreciation_amortization','6900'),
        ('bad_debt','7000'),
        ('miscellaneous_expense','7100'),
        ('uncategorized_expense','7150'),
        ('interest_expense','8000'),
        ('income_tax_expense','8100'),
        ('gain_loss_disposal','8200'))

-- ── (1) ROLES A COMPANY IS MISSING ENTIRELY ──────────────────────────────────
-- No account carries this role, so every lookup for it falls back to the client's hardcoded
-- default (the O110 "absorber") and may MATERIALISE an account nobody chose.
select
  c.name                                   as company,
  count(*)                                 as roles_missing,
  string_agg(cn.role, ', ' order by cn.role) as which
from public.companies c
cross join canonical cn
where not exists (
  select 1 from public.accounts a
  where a.company_id = c.id and a.system_role = cn.role
)
group by c.name
order by roles_missing desc;


-- ── (2) ACCOUNTS THAT EXIST BUT CARRY NO ROLE — the SAFE half ────────────────
-- These are fixable by setting a role: the account is already there, already numbered, and
-- already carrying whatever history it has. Nothing moves.
--
-- ★ `origin <> 'external'` EXCLUDES THE 36 FOREIGN-CHART ACCOUNTS (`O110`). They came from
-- outside the application in a numbering scheme this codebase does not recognise, so giving
-- them our roles would collide — two accounts claiming `utilities` on one company, with
-- `byRole` silently keeping whichever it saw last. That is a booking hazard introduced to
-- tidy a report.
select
  c.name          as company,
  a.code,
  a.name          as account,
  a.origin,
  count(l.id)     as journal_lines,
  case when count(l.id) > 0
       then 'has history — set the role, never renumber'
       else 'no history — safe either way'
  end             as note
from public.accounts a
join public.companies c on c.id = a.company_id
left join public.journal_entry_lines l on l.account_id = a.id
where a.system_role is null
  and coalesce(a.origin, 'runtime') <> 'external'
group by c.name, a.code, a.name, a.origin
order by c.name, a.code;


-- ── (3) ONE ROLE, DIFFERENT CODES ACROSS COMPANIES — the UNSAFE half ─────────
-- ★★ REPORTED, NEVER FIXED HERE. Renumbering means re-pointing every journal line that
-- references the account; doing it as a data patch silently re-files history, and a chart is
-- the client's record of how THEY organise their books — a variant code may be deliberate.
-- The value of this list is knowing where the variance is, not erasing it.
select
  a.system_role,
  count(distinct a.code)                                        as distinct_codes,
  string_agg(distinct a.code, ', ' order by a.code)             as codes,
  count(distinct a.company_id)                                  as companies
from public.accounts a
where a.system_role is not null
group by a.system_role
having count(distinct a.code) > 1
order by distinct_codes desc, a.system_role;


-- ── (4) THE HEADLINE, so the three lists above have a summary to sit under ───
select
  (select count(*) from public.companies)                                          as companies,
  (select count(*) from public.accounts where system_role is null
      and coalesce(origin,'runtime') <> 'external')                                as roleless_ours,
  (select count(*) from public.accounts where coalesce(origin,'runtime') = 'external') as roleless_foreign,
  (select count(*) from (
      select system_role from public.accounts where system_role is not null
      group by system_role having count(distinct code) > 1) v)                     as roles_with_variant_codes;
