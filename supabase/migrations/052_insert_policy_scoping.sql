-- =====================================================================
-- 052_insert_policy_scoping.sql
-- CODE REVIEW · CR-11 / CR-12 — the O21 remainder. Two permissive
-- `WITH CHECK (true)` INSERT policies let ANY authenticated user INSERT
-- arbitrary rows (company/user spoofing + spam vector — not a read leak,
-- but the last policy-hygiene gap).
--
-- Neither is used by a legitimate flow. Both real insert paths are
-- SECURITY DEFINER and bypass RLS entirely:
--   * companies    → public.create_company()  (RPC; migration 001, baseline 000)
--   * public.users → public.handle_new_user()  (trigger on auth.users)
-- The client only ever SELECTs / UPDATEs these tables — it never INSERTs
-- directly (verified: CompanySetup calls rpc('create_company'); no
-- .from('companies'|'users').insert() anywhere in src/).
--
-- FIX:
--   1. companies_insert → DROPPED (no replacement). A scoped WITH CHECK is
--      IMPOSSIBLE here: at companies-INSERT time the creator's company_users
--      (owner) row does not exist yet — the chicken-and-egg that is the whole
--      reason creation goes through the atomic SECURITY DEFINER
--      create_company(). With no INSERT policy, direct client inserts are
--      denied by RLS default-deny while the RPC still works. This restores
--      migration 001's documented intent ("Intentionally NO direct INSERT
--      policy … onboarding must go through create_company()").
--   2. users_insert → scoped to WITH CHECK (id = auth.uid()): a user may
--      insert ONLY their own row (mirrors users_select_own / users_update_own),
--      never spoof or manufacture another user's id. handle_new_user()
--      (SECURITY DEFINER) is unaffected and remains the real populate path.
--
-- Does NOT touch: create_company, handle_new_user, accept_invite (051), or the
-- company_users policies — so signup, company creation, invite acceptance, and
-- team-member sync all continue to work.
--
-- Requires: RLS already enabled on both tables (companies 000/001, users 000).
-- Idempotent (drop-if-exists + create); safe to re-run; a no-op once applied.
-- =====================================================================
begin;

-- 1. companies: remove the permissive direct-INSERT vector. No replacement —
--    create_company() (SECURITY DEFINER) is the sole legitimate path, and a
--    per-user WITH CHECK cannot exist pre-membership (see header).
drop policy if exists companies_insert on public.companies;

-- 2. users: a user may insert only their OWN row, never spoof another id.
--    (The auth.users → public.users trigger runs SECURITY DEFINER and is
--    unaffected; this only constrains a direct client insert.)
drop policy if exists users_insert on public.users;
create policy users_insert on public.users
  for insert to authenticated
  with check (id = auth.uid());

commit;
