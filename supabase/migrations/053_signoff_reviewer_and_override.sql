-- =====================================================================
-- 053_signoff_reviewer_and_override.sql  (O83 Issue 1)
-- (Renumbered from 051 — that number collided with 051_invite_hardening,
--  which caused the migration tracker to skip this file. Applied to
--  production hhhuvoycumjzcjbawwff on 2026-07-21 via the Management API;
--  idempotent, so a future `db push` re-applies it as a safe no-op.)
--
-- Hardens period sign-off (attestation):
--   1. Override acknowledgment + revocation columns on period_signoffs
--      (explicit pre-flight override is RECORDED; reopen is a SOFT revoke, not a
--      hard delete — the row and its history survive).
--   2. A REVIEWER predicate (is_company_reviewer) = admin OR accountant, NOT the
--      plain client-owner. Attestation is a separation-of-duties action: the owner
--      who owns the books must not self-attest. (`accountant` already exists in the
--      company_users role CHECK — no constraint change needed.)
--   3. Data mapping so NO existing company is left without a valid attester: any
--      company with no admin/accountant member has its OWNER promoted to admin (a
--      solo operator / self-serve signup who was their own reviewer). Multi-user
--      companies that already have an admin/accountant are untouched — the
--      client-owner there correctly loses self-attest.
--
-- Apply 050 first (period_signoffs). Idempotent; safe to re-apply.
-- =====================================================================
begin;

-- 1. Override acknowledgment + soft-revocation + the blockers that were overridden.
alter table public.period_signoffs
  add column if not exists override_ack      boolean     not null default false,
  add column if not exists override_reason   text,
  add column if not exists blockers_snapshot jsonb,
  add column if not exists revoked_at        timestamptz,
  add column if not exists revoked_by        uuid;

-- 2. REVIEWER predicate — attestation is an admin/accountant (reviewer/CPA) action,
--    NOT the plain owner (the client). SECURITY DEFINER so it reads company_users
--    with RLS bypassed (same pattern/rationale as is_company_admin). Platform admins
--    pass through for Support Mode (mirrors is_company_member).
create or replace function public.is_company_reviewer(cid uuid) returns boolean
    language sql stable security definer set search_path to 'public', 'pg_temp'
    as $$
  select public.is_platform_admin()
      or exists (
        select 1 from public.company_users cu
        where cu.company_id = cid
          and cu.user_id = auth.uid()
          and cu.accepted_at is not null
          and cu.role in ('admin', 'accountant')
      );
$$;

-- 3. NO ORPHANED COMPANY: promote the owner to admin for any company that has no
--    admin/accountant member. (An owner row is never itself admin/accountant, so
--    the NOT EXISTS is the "company has no separate reviewer" test.) Idempotent:
--    after the promotion the company has an admin, so a re-run is a no-op.
update public.company_users o
   set role = 'admin'
 where o.role = 'owner'
   and not exists (
     select 1 from public.company_users r
      where r.company_id = o.company_id
        and r.role in ('admin', 'accountant')
   );

-- 4. Re-gate period_signoffs writes on the REVIEWER predicate (was is_company_admin,
--    which included the owner). SELECT stays open to any member (drives the
--    owner-facing "reviewed through" badge).
drop policy if exists period_signoffs_insert on public.period_signoffs;
create policy period_signoffs_insert on public.period_signoffs
  for insert to authenticated
  with check (public.is_company_reviewer(company_id) and signed_by = auth.uid());

-- UPDATE covers BOTH re-signing (upsert) and soft-revoke; reviewer-only, but the
-- with-check does NOT force signed_by=auth.uid() so any reviewer may revoke another's
-- sign-off (revoked_by attribution is set by the app). signed_by on re-sign is set to
-- self by the app's upsert.
drop policy if exists period_signoffs_update on public.period_signoffs;
create policy period_signoffs_update on public.period_signoffs
  for update to authenticated
  using (public.is_company_reviewer(company_id))
  with check (public.is_company_reviewer(company_id));

-- Hard delete stays reviewer-only (the app now soft-revokes; kept for manual cleanup).
drop policy if exists period_signoffs_delete on public.period_signoffs;
create policy period_signoffs_delete on public.period_signoffs
  for delete to authenticated using (public.is_company_reviewer(company_id));

commit;
