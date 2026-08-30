-- 081 — A MEMBER COULD GRANT THEMSELVES ANY ROLE, AND A STRANGER COULD JOIN ANY COMPANY.
--
-- ⚠ READ FROM THE POLICY TEXT AND THE CALLER SWEEP. `supabase/verify/081_self_escalation.sql`
-- DEMONSTRATES IT before this is applied and proves the refusal after. Run it first — this
-- project's own standard is that a claim about the database is a claim about a query
-- somebody ran.
--
-- ── THE TWO CLAUSES ──────────────────────────────────────────────────────────
-- `001` gave `company_users` the usual four policies, each carrying `user_id = auth.uid()`
-- alongside the admin test. The intent is documented in the file: *"a user may insert a
-- membership only for themselves (used when accepting an invite)"*. But the clause is not
-- scoped to the ROLE or to the COMPANY, so it says considerably more than that:
--
--   (1) **UPDATE — self-promotion.** A member may update their own row, and `role` is on
--       that row. **A `viewer` can make themselves `admin`.** That is the entire role system
--       C225 just repaired, undone in one call. **And an OWNER can make themselves `admin`,
--       which makes them a reviewer** (`is_company_reviewer` = admin or accountant) — so
--       they can sign off their own books, which is what `O93` exists to prevent and what a
--       live probe confirmed the database otherwise refuses.
--
--   (2) **INSERT — joining a company you were never invited to.** `with check (user_id =
--       auth.uid() or …)` does not constrain `company_id`. An authenticated user may insert
--       `(company_id = <any company>, user_id = self, role = 'admin', accepted_at = now())`,
--       and `is_company_member` asks for exactly that row — so **every tenant table opens.**
--       The only obstacle is knowing the company's uuid, which is not a secret and is not a
--       security boundary.
--
-- ★★ NEITHER CLAUSE IS USED BY ANYTHING. Every membership write in the product goes through
-- a SECURITY DEFINER function that bypasses RLS entirely — `create_company` (`001`/`000`)
-- and `accept_invite` (`027`/`051`). **`src/` never writes `company_users` at all**: two
-- SELECTs and nothing else. So this removes an ability no legitimate flow has ever used.
--
-- ★ WHY THE TIER 1 AUDIT DID NOT CATCH IT, WHICH IS THE DURABLE PART. That audit asked *"is
-- RLS enabled, and does a policy exist, for every table carrying `company_id`?"* — and the
-- answer was 33 of 33, correctly. **It never asked what the policies PERMIT.** A table can
-- be fully covered and still hand out admin. `052` sits one inch away, fixing exactly this
-- shape on `companies` and `users`, and says in its own header: *"Does NOT touch … the
-- company_users policies."*
--
-- ── THE FIX, AND WHY IT IS A TRIGGER AND NOT JUST A POLICY ───────────────────
-- INSERT is a policy change: admin-only, because both real paths are SECURITY DEFINER.
--
-- UPDATE cannot be, because **RLS `WITH CHECK` cannot see the OLD row**, so a policy can
-- express "the new role is admin" but not "the role CHANGED". Blocking self-update outright
-- would be the `079` mistake — blocking more than the thing we mean, and the first symptom
-- would be an ordinary membership edit failing. A trigger can compare, so it refuses exactly
-- the role change and leaves everything else alone.
--
-- ★ AND IT REFUSES CHANGING YOUR OWN ROLE **EVEN AS AN ADMIN OR OWNER**. That is not
-- belt-and-braces, it is `O93`: an owner who can promote themselves to admin can attest to
-- their own books, and the whole point of the reviewer split is that the person who keeps
-- the books is not the person who signs them. **You may manage other people's roles; you may
-- not manage your own.** An admin who needs to change their own role asks another admin —
-- which is the correct amount of friction for that operation.
--
-- ▶ `auth.uid() is null` is EXEMPT: that is a migration or a service-role operation, not a
-- person escalating. `053` already rewrites roles in bulk that way, and a future correction
-- must not be blocked by this.
--
-- Idempotent.

begin;

-- ── (1) INSERT: only an admin adds a member ──────────────────────────────────
drop policy if exists company_users_insert on public.company_users;
create policy company_users_insert on public.company_users
  for insert to authenticated
  with check (public.is_company_admin(company_id));

-- ── (2) UPDATE: nobody changes a role except an admin, and nobody changes their own ──
create or replace function public.guard_company_user_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Not a person: a migration or a service-role write. `053` does exactly this.
  if auth.uid() is null then return NEW; end if;

  if NEW.role is not distinct from OLD.role then
    return NEW;                       -- amount-free edit; not this guard's business
  end if;

  if NEW.user_id = auth.uid() or OLD.user_id = auth.uid() then
    raise exception 'You cannot change your own role. Ask another admin on this company to do it.'
      using errcode = 'insufficient_privilege';
  end if;

  if not public.is_company_admin(coalesce(NEW.company_id, OLD.company_id)) then
    raise exception 'Only an owner or admin can change a team member''s role.'
      using errcode = 'insufficient_privilege';
  end if;

  return NEW;
end $$;

drop trigger if exists guard_company_user_role on public.company_users;
create trigger guard_company_user_role
  before update on public.company_users
  for each row execute function public.guard_company_user_role();

commit;
