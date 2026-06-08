-- =====================================================================
-- 018_security_check.sql
-- Read-only introspection RPC powering the Settings → Security dashboard.
-- Returns, for the critical multi-tenant tables:
--   * rls:      whether each table exists and has row-level security enabled
--   * policies: every RLS policy + whether it gates on company membership
-- The browser ships the anon key and cannot read pg_catalog, so this runs
-- SECURITY DEFINER. It exposes only schema metadata (never row data) and is
-- granted to authenticated users so the app can self-verify isolation.
-- =====================================================================

create or replace function public.security_check()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_rls      jsonb;
  v_policies jsonb;
  critical text[] := array[
    'journal_entries','journal_entry_lines','contacts','contracts','accounts',
    'audit_log','documents','bank_accounts','recurring_transactions','vendor_rules',
    'ar_invoices','chat_messages','tax_settings','reconciliations','companies','company_users'
  ];
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- RLS status per critical table (relrowsecurity on the table in the public schema).
  select coalesce(jsonb_agg(jsonb_build_object(
           'table',   t,
           'exists',  (c.relname is not null),
           'enabled', coalesce(c.relrowsecurity, false)
         ) order by t), '[]'::jsonb)
    into v_rls
  from unnest(critical) as t
  left join pg_class c
    on c.relname = t
   and c.relnamespace = 'public'::regnamespace
   and c.relkind = 'r';

  -- Every policy on those tables, flagged for whether it checks company membership.
  -- A policy is considered "scoped" if its USING or WITH CHECK expression references
  -- the membership helpers, company_id, or auth.uid() (companies/company_users gate
  -- on id/user_id = auth.uid()). Anything else (e.g. a `true` policy) is "open".
  select coalesce(jsonb_agg(jsonb_build_object(
           'table',  p.tablename,
           'policy', p.policyname,
           'cmd',    p.cmd,
           'has_company_check',
             ((coalesce(p.qual,'') || ' ' || coalesce(p.with_check,''))
                ~ 'is_company_member|is_company_admin|company_id|auth\.uid')
         ) order by p.tablename, p.policyname), '[]'::jsonb)
    into v_policies
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = any(critical);

  return jsonb_build_object(
    'rls', v_rls,
    'policies', v_policies,
    'generated_at', now()
  );
end;
$$;

revoke all on function public.security_check() from public;
grant execute on function public.security_check() to authenticated;
