-- =====================================================================
-- 030_booking_visibility_failures.sql
-- Platform-admin counter for the post-booking visibility invariant.
-- booking_visibility_failure rows are written to audit_log by the client
-- (logAudit) whenever a saved entry isn't visible in the refreshed ledger.
-- This RPC aggregates them across ALL companies for the admin Problems tab.
-- Gated on the platform-admin email (Option A), matching PLATFORM_ADMIN_EMAILS.
-- =====================================================================
begin;

create or replace function public.get_admin_visibility_failures(p_days int default 30)
returns table (company_id uuid, company_name text, detail text, created_at timestamptz)
language sql security definer set search_path = public, pg_temp as $$
  select a.company_id, c.name::text, a.detail, a.created_at
  from public.audit_log a
  left join public.companies c on c.id = a.company_id
  where a.action = 'booking_visibility_failure'
    and a.created_at >= now() - make_interval(days => greatest(1, p_days))
    and (auth.jwt() ->> 'email') = any (array['alexabdella@gmail.com'])  -- platform admin only
  order by a.created_at desc;
$$;
revoke all on function public.get_admin_visibility_failures(int) from public;
grant execute on function public.get_admin_visibility_failures(int) to authenticated;

commit;
