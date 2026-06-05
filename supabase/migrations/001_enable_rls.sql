-- =====================================================================
-- 001_enable_rls.sql
-- Enable Row Level Security (RLS) and tenant-isolation policies for every
-- multi-tenant table in the ledger app.
--
-- WHY: the client ships the public anon key and currently relies on
-- client-side `.eq("company_id", ...)` filters for isolation. Those filters
-- are NOT a security boundary — anyone with the anon key can craft requests
-- for arbitrary company_id values. RLS enforced in the database is the only
-- real boundary. After this migration, even a fully attacker-controlled
-- client can only read/write rows for companies the user belongs to.
--
-- DO NOT run blindly in production:
--   * This assumes each table below has a `company_id uuid` column
--     (journal_entry_lines confirmed; verify ar_invoice_lines and
--     unknown_documents — see notes at the bottom).
--   * Enabling RLS will BREAK onboarding (CompanySetup) until that flow is
--     switched to the public.create_company() RPC defined here. See report.
--   * Run inside a transaction and test with a non-owner user before
--     exposing to production traffic.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Membership helper.
--    SECURITY DEFINER so it reads company_users with RLS bypassed — this
--    both avoids infinite recursion (policies on other tables call this,
--    and company_users itself has RLS) and keeps the check fast.
-- ---------------------------------------------------------------------
create or replace function public.is_company_member(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.company_users cu
    where cu.company_id = cid
      and cu.user_id = auth.uid()
      and cu.accepted_at is not null
  );
$$;

revoke all on function public.is_company_member(uuid) from public;
grant execute on function public.is_company_member(uuid) to authenticated;

-- Optional role helper (owner/admin) for privileged operations.
create or replace function public.is_company_admin(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.company_users cu
    where cu.company_id = cid
      and cu.user_id = auth.uid()
      and cu.accepted_at is not null
      and cu.role in ('owner','admin')
  );
$$;

revoke all on function public.is_company_admin(uuid) from public;
grant execute on function public.is_company_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Uniform company-scoped tables (have a company_id column).
--    SELECT / INSERT / UPDATE / DELETE all gated on membership.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  company_tables text[] := array[
    'accounts',
    'audit_log',
    'ar_invoices',
    'ar_invoice_lines',
    'bank_accounts',
    'contacts',
    'contracts',
    'journal_entries',
    'journal_entry_lines',
    'recurring_transactions',
    'subscriptions',
    'unknown_documents',
    'vendor_rules'
  ];
begin
  foreach t in array company_tables loop
    execute format('alter table public.%I enable row level security;', t);

    execute format('drop policy if exists %I on public.%I;', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_company_member(company_id));',
      t || '_select', t);

    execute format('drop policy if exists %I on public.%I;', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_company_member(company_id));',
      t || '_insert', t);

    execute format('drop policy if exists %I on public.%I;', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));',
      t || '_update', t);

    execute format('drop policy if exists %I on public.%I;', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_company_member(company_id));',
      t || '_delete', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. companies (keyed by id, not company_id).
--    Members can read; admins/owners can update; owners can delete.
--    Direct INSERT is blocked — onboarding must go through create_company()
--    so that the owner membership row is created atomically (otherwise the
--    creator could not read back the row they just inserted).
-- ---------------------------------------------------------------------
alter table public.companies enable row level security;

drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies
  for select to authenticated
  using (public.is_company_member(id));

drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies
  for update to authenticated
  using (public.is_company_admin(id))
  with check (public.is_company_admin(id));

drop policy if exists companies_delete on public.companies;
create policy companies_delete on public.companies
  for delete to authenticated
  using (public.is_company_admin(id));

-- Intentionally NO direct INSERT policy → client cannot insert companies
-- directly. Use create_company() below.

-- ---------------------------------------------------------------------
-- 4. company_users (the membership table).
--    A user can see/manage their OWN membership rows; company admins can
--    manage everyone in their company (for invites / role changes).
-- ---------------------------------------------------------------------
alter table public.company_users enable row level security;

drop policy if exists company_users_select on public.company_users;
create policy company_users_select on public.company_users
  for select to authenticated
  using (user_id = auth.uid() or public.is_company_admin(company_id));

-- A user may insert a membership only for themselves (used when accepting an
-- invite); admins may add members to their company.
drop policy if exists company_users_insert on public.company_users;
create policy company_users_insert on public.company_users
  for insert to authenticated
  with check (user_id = auth.uid() or public.is_company_admin(company_id));

drop policy if exists company_users_update on public.company_users;
create policy company_users_update on public.company_users
  for update to authenticated
  using (user_id = auth.uid() or public.is_company_admin(company_id))
  with check (user_id = auth.uid() or public.is_company_admin(company_id));

drop policy if exists company_users_delete on public.company_users;
create policy company_users_delete on public.company_users
  for delete to authenticated
  using (user_id = auth.uid() or public.is_company_admin(company_id));

-- ---------------------------------------------------------------------
-- 5. Atomic company creation (replaces the client-side
--    companies.insert + company_users.insert pair in CompanySetup).
--    SECURITY DEFINER so it can create the company + owner membory row in
--    one shot, bypassing the (intentionally missing) companies INSERT policy.
-- ---------------------------------------------------------------------
create or replace function public.create_company(p_name text)
returns public.companies
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.companies;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'company name required';
  end if;

  insert into public.companies (name) values (btrim(p_name)) returning * into c;

  insert into public.company_users (company_id, user_id, role, accepted_at)
  values (c.id, auth.uid(), 'owner', now());

  return c;
end;
$$;

revoke all on function public.create_company(text) from public;
grant execute on function public.create_company(text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Make sure the account-seeding RPC is itself locked down.
--    seed_company_accounts() is called from the client during onboarding.
--    It must be SECURITY DEFINER AND must verify the caller is a member of
--    the target company, otherwise any user could seed (and infer the
--    existence of) arbitrary companies. Recreate/guard accordingly:
--
--    Example hardening (uncomment + adapt to your existing definition):
--
--    create or replace function public.seed_company_accounts(p_company_id uuid)
--    returns void language plpgsql security definer
--    set search_path = public, pg_temp as $fn$
--    begin
--      if not public.is_company_member(p_company_id) then
--        raise exception 'not a member of company %', p_company_id;
--      end if;
--      -- ... existing seeding logic ...
--    end;
--    $fn$;
--    revoke all on function public.seed_company_accounts(uuid) from public;
--    grant execute on function public.seed_company_accounts(uuid) to authenticated;

commit;

-- =====================================================================
-- NOTES / ASSUMPTIONS — verify before running
-- =====================================================================
-- * Every table in section 2 is assumed to have a `company_id uuid` column.
--   journal_entry_lines is confirmed (the app sets company_id on every line
--   insert). VERIFY ar_invoice_lines and unknown_documents actually carry
--   company_id. If a child table does NOT have company_id, replace its four
--   policies with a parent-EXISTS form, e.g. for ar_invoice_lines:
--     using (exists (select 1 from public.ar_invoices p
--                    where p.id = ar_invoice_lines.ar_invoice_id
--                      and public.is_company_member(p.company_id)))
--
-- * These policies grant access to the `authenticated` role only. The
--   `anon` role gets no policies, so unauthenticated requests see nothing.
--
-- * Service-role / server-side jobs bypass RLS (as intended). Edge functions
--   that use the service-role key are NOT constrained by these policies.
--
-- * RLS is default-deny once enabled: any table with RLS on and no matching
--   policy returns zero rows. Double-check no background job relies on the
--   anon/authenticated client reading these tables without membership.
-- =====================================================================
