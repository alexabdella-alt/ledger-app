-- ═══════════════════════════════════════════════════════════════════════════════
-- 081 — DEMONSTRATE THE HOLE, THEN PROVE THE REFUSAL.
--
-- ★★ RUN (A) AND (B) **BEFORE** APPLYING `081`. They are expected to say **FAIL**, and that
-- FAIL is the evidence the migration is needed. A claim about what a database permits is a
-- claim about a query somebody ran — this file is that query. Everything rolls back.
--
-- Then apply `081` and run (A) and (B) again: both must flip to PASS. (C) proves the
-- migration did not block ordinary membership edits, which is the `079` failure direction
-- and the one that only shows up when someone tries to do their job.
--
-- Each block borrows a real member's identity and switches to the `authenticated` role, so
-- the policies actually apply — the editor's own session is a superuser that bypasses RLS
-- entirely. **Every block reports the role it ran as**; if that is not `authenticated`, the
-- verdict is meaningless.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── (A) CAN A MEMBER PROMOTE THEMSELVES? ─────────────────────────────────────
-- BEFORE 081: expect FAIL (they can). AFTER: expect PASS (refused).
do $$
declare v text; who text; n int; u uuid; c uuid; r text;
begin
  select cu.user_id, cu.company_id, cu.role into u, c, r
  from public.company_users cu
  join auth.users au on au.id = cu.user_id
  where cu.accepted_at is not null
    and lower(au.email) <> 'alexabdella@gmail.com'
  limit 1;
  if u is null then
    raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no non-platform-admin member exists';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  who := current_user;

  begin
    update public.company_users set role = 'admin' where user_id = u and company_id = c;
    get diagnostics n = row_count;
    if n = 1 then
      v := 'FAIL - a ' || r || ' promoted THEMSELVES to admin (this is the hole 081 closes)';
    else
      v := 'PASS - the self-promotion matched no rows';
    end if;
  exception
    when insufficient_privilege then v := 'PASS - refused: ' || SQLERRM;
    when others then v := 'INCONCLUSIVE - failed for another reason: ' || SQLERRM;
  end;

  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): % [ran as: %]', v, who;
end $$;


-- ── (A2) THE SAME CHECK, BUT WITH AN ACTUAL PROMOTION ────────────────────────
-- ★★ (A) RAN LIVE AND RETURNED `FAIL - a admin promoted THEMSELVES to admin`. The specimen
-- it borrowed was ALREADY an admin, so the role did not change: it proves the role column
-- is self-writable and **does not demonstrate ESCALATION**, which is one inference further
-- than the observation. Recorded rather than quietly re-run, because "the update was
-- permitted" and "a viewer can become an admin" are different claims and only the second is
-- the finding.
--
-- This one requires the borrowed member to be BELOW admin, so a success is a real promotion.
do $$
declare v text; who text; n int; u uuid; c uuid; r text;
begin
  select cu.user_id, cu.company_id, cu.role into u, c, r
  from public.company_users cu
  join auth.users au on au.id = cu.user_id
  where cu.accepted_at is not null
    and cu.role not in ('owner','admin')
    and lower(au.email) <> 'alexabdella@gmail.com'
  limit 1;
  if u is null then
    -- ★ AND THE OWNER CASE IS STILL WORTH TESTING even with no viewer on the books: an owner
    -- promoting themselves to `admin` is not a privilege gain in most respects, but it DOES
    -- make them a reviewer — which is O93's hole exactly.
    select cu.user_id, cu.company_id, cu.role into u, c, r
    from public.company_users cu
    join auth.users au on au.id = cu.user_id
    where cu.accepted_at is not null and cu.role = 'owner'
      and lower(au.email) <> 'alexabdella@gmail.com'
    limit 1;
  end if;
  if u is null then
    raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no member below admin to promote';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  who := current_user;

  begin
    update public.company_users set role = 'admin' where user_id = u and company_id = c and role <> 'admin';
    get diagnostics n = row_count;
    if n = 1 then
      v := 'FAIL - a ' || r || ' promoted THEMSELVES to admin' ||
           case when r = 'owner' then ' (and is now a reviewer, so can sign off their own books)' else '' end;
    else
      v := 'PASS - the self-promotion matched no rows';
    end if;
  exception
    when insufficient_privilege then v := 'PASS - refused: ' || SQLERRM;
    when others then v := 'INCONCLUSIVE - failed for another reason: ' || SQLERRM;
  end;

  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): % [ran as: %]', v, who;
end $$;


-- ── (B) CAN A STRANGER JOIN A COMPANY THEY WERE NEVER INVITED TO? ────────────
-- The serious one. BEFORE 081: expect FAIL. AFTER: expect PASS.
do $$
declare v text; who text; u uuid; target uuid; seen int;
begin
  select cu.user_id into u
  from public.company_users cu
  join auth.users au on au.id = cu.user_id
  where cu.accepted_at is not null
    and lower(au.email) <> 'alexabdella@gmail.com'
  limit 1;
  if u is null then
    raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no non-platform-admin member exists';
  end if;

  -- A company this user has nothing to do with, that actually holds entries — so a
  -- successful join can be shown to yield real data rather than an empty set.
  select je.company_id into target
  from public.journal_entries je
  where je.deleted_at is null
    and not exists (select 1 from public.company_users x where x.company_id = je.company_id and x.user_id = u)
  group by je.company_id having count(*) > 0
  limit 1;
  if target is null then
    raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no other tenant with entries to target';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  who := current_user;

  begin
    insert into public.company_users (company_id, user_id, role, accepted_at)
    values (target, u, 'admin', now());
    -- ★ THE JOIN IS NOT THE DAMAGE — THE READ IS. Count what the new membership unlocks, so
    -- a FAIL states the consequence rather than the mechanism.
    select count(*) into seen from public.journal_entries where company_id = target;
    v := 'FAIL - joined another company as admin and can now read ' || seen || ' of its journal entries';
  exception
    when insufficient_privilege then v := 'PASS - refused: ' || SQLERRM;
    when others then v := 'INCONCLUSIVE - failed for another reason: ' || SQLERRM;
  end;

  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): % [ran as: %]', v, who;
end $$;


-- ── (C) AFTER 081 ONLY — ★ DID IT BLOCK MORE THAN IT MEANT TO? ───────────────
-- The `079` direction. An admin changing SOMEONE ELSE's role is the ordinary operation this
-- guard must leave alone, and "it blocks too much" is the failure that surfaces only when a
-- real person tries to do their job. Expect PASS.
do $$
declare v text; who text; n int; adm uuid; c uuid; victim uuid;
begin
  select cu.user_id, cu.company_id into adm, c
  from public.company_users cu
  where cu.accepted_at is not null and cu.role in ('owner','admin')
  limit 1;
  select cu.user_id into victim
  from public.company_users cu
  where cu.company_id = c and cu.user_id <> adm and cu.accepted_at is not null
  limit 1;
  if adm is null or victim is null then
    raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - need a company with an admin AND a second member';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', adm::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  who := current_user;

  begin
    update public.company_users set role = 'accountant' where user_id = victim and company_id = c;
    get diagnostics n = row_count;
    if n = 1 then v := 'PASS - an admin can still change someone else''s role';
    else v := 'INCONCLUSIVE - the update matched ' || n || ' rows, so nothing was tested';
    end if;
  exception when others then
    v := 'FAIL - 081 blocked an ordinary role change: ' || SQLERRM;
  end;

  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): % [ran as: %]', v, who;
end $$;
