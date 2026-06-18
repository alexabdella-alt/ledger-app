-- =====================================================================
-- 036_reassert_baseline_functions.sql
-- Fix-forward for function divergence exposed by the 000 baseline. Five
-- SECURITY DEFINER functions were last modified on the live database by
-- migrations that were applied directly and never committed (016/017/020/025).
-- The committed chain therefore re-creates OLDER bodies than live, and on a
-- rebuild (000 -> 001..035) the create-or-replace in those older migrations
-- would leave the function at the stale body — most importantly
-- is_company_member would LOSE the platform-admin bypass (Option A), silently
-- breaking Support Mode.
--
-- This terminal migration re-asserts the LIVE definitions verbatim (from the
-- 000 dump) so a rebuild terminates exactly at the live schema. It is a no-op on
-- the live database (identical bodies) and idempotent (create or replace).
-- Existing GRANT/REVOKE on these functions are preserved by create-or-replace.
-- =====================================================================
begin;

-- ── is_company_member ──
CREATE OR REPLACE FUNCTION public.is_company_member(cid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select public.is_platform_admin()
      or exists (select 1 from public.company_users cu
                 where cu.company_id = cid and cu.user_id = auth.uid() and cu.accepted_at is not null);
$$;
revoke all on function public.is_company_member(uuid) from public;
grant execute on function public.is_company_member(uuid) to authenticated;


-- ── post_journal_entry ──
CREATE OR REPLACE FUNCTION public.post_journal_entry(p_company_id uuid, p_entry_date date, p_description text, p_source text, p_created_by uuid, p_lines jsonb, p_meta jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_entry_id     uuid;
  v_total_debit  numeric := 0;
  v_total_credit numeric := 0;
  v_line         jsonb;
  v_result       jsonb;
begin
  if not public.is_company_member(p_company_id) then
    raise exception 'not a member of company %', p_company_id using errcode = '42501';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'journal entry must have at least one line';
  end if;

  select coalesce(sum((l->>'debit')::numeric), 0),
         coalesce(sum((l->>'credit')::numeric), 0)
    into v_total_debit, v_total_credit
    from jsonb_array_elements(p_lines) as l;

  if round(v_total_debit, 2) <> round(v_total_credit, 2) then
    raise exception 'journal entry not balanced: debits % <> credits %', v_total_debit, v_total_credit;
  end if;

  insert into public.journal_entries (
    company_id, entry_date, description, source, status, posted_at, created_by,
    ai_reasoning, ai_confidence, approval_status, payment_status, payment_method, due_date
  ) values (
    p_company_id, p_entry_date, p_description, coalesce(p_source, 'manual'), 'posted', now(), p_created_by,
    nullif(p_meta->>'ai_reasoning', ''),
    nullif(p_meta->>'ai_confidence', '')::numeric,
    nullif(p_meta->>'approval_status', ''),
    nullif(p_meta->>'payment_status', ''),
    nullif(p_meta->>'payment_method', ''),
    nullif(p_meta->>'due_date', '')::date
  )
  returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    if (v_line->>'account_id') is null then
      raise exception 'every line must have an account_id';
    end if;
    insert into public.journal_entry_lines (journal_entry_id, company_id, account_id, debit, credit, memo)
    values (
      v_entry_id, p_company_id,
      (v_line->>'account_id')::uuid,
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      v_line->>'memo'
    );
  end loop;

  select jsonb_build_object(
    'id', v_entry_id,
    'entry', to_jsonb(je.*),
    'lines', coalesce(
      (select jsonb_agg(to_jsonb(jel.*)) from public.journal_entry_lines jel where jel.journal_entry_id = v_entry_id),
      '[]'::jsonb)
  ) into v_result
  from public.journal_entries je
  where je.id = v_entry_id;

  return v_result;
exception
  when others then
    raise;
end;
$$;
revoke all on function public.post_journal_entry(uuid, date, text, text, uuid, jsonb, jsonb) from public;
grant execute on function public.post_journal_entry(uuid, date, text, text, uuid, jsonb, jsonb) to authenticated;


-- ── seed_company_accounts ──
CREATE OR REPLACE FUNCTION public.seed_company_accounts(p_company_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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


-- ── security_check ──
CREATE OR REPLACE FUNCTION public.security_check() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog', 'pg_temp'
    AS $$
declare
  v_rls jsonb; v_policies jsonb;
  critical text[] := array[
    'journal_entries','journal_entry_lines','contacts','contracts','accounts',
    'audit_log','documents','bank_accounts','recurring_transactions','vendor_rules',
    'ar_invoices','chat_messages','tax_settings','reconciliations','companies','company_users'];
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('table',t,'exists',(c.relname is not null),
           'enabled',coalesce(c.relrowsecurity,false)) order by t),'[]'::jsonb)
    into v_rls
  from unnest(critical) as t
  left join pg_class c on c.relname=t and c.relnamespace='public'::regnamespace and c.relkind='r';
  select coalesce(jsonb_agg(jsonb_build_object(
           'table',p.tablename,
           'policy',p.policyname,
           'cmd',p.cmd,
           'has_company_check',((coalesce(p.qual,'')||' '||coalesce(p.with_check,''))
              ~ 'is_company_member|is_company_admin|company_id|auth\.uid'),
           'expected',(p.tablename='companies' and p.cmd='INSERT')
         ) order by p.tablename,p.policyname),'[]'::jsonb)
    into v_policies
  from pg_policies p where p.schemaname='public' and p.tablename = any(critical);
  return jsonb_build_object('rls',v_rls,'policies',v_policies,'generated_at',now());
end; $$;
revoke all on function public.security_check() from public;
grant execute on function public.security_check() to authenticated;


-- ── list_company_members ──
CREATE OR REPLACE FUNCTION public.list_company_members(p_company uuid) RETURNS TABLE(user_id uuid, email text, full_name text, role text, accepted_at timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select cu.user_id, u.email::text,
         coalesce(u.raw_user_meta_data->>'full_name', '')::text,
         cu.role, cu.accepted_at
  from public.company_users cu
  join auth.users u on u.id = cu.user_id
  where cu.company_id = p_company
    and public.is_company_admin(p_company);
$$;
revoke all on function public.list_company_members(uuid) from public;
grant execute on function public.list_company_members(uuid) to authenticated;

commit;
