-- VERIFY (e2) — ★★★ THE CHECK (e) COULD NOT MAKE: does `company_has_reviewer` ACTUALLY
-- DISCRIMINATE? (e) came back INCONCLUSIVE because no company has both an owner and a
-- reviewer — so the separation direction was UNPROVEN, and that is the dangerous direction
-- here: if `company_has_reviewer` always returned false, checks (c) and (d) would BOTH still
-- have passed exactly as they did, while every owner in the system could self-attest.
--
-- So this SEEDS the reviewer itself rather than depending on the data being shaped right —
-- the same fix `081`'s check (c) needed. The seed goes in as the superuser BEFORE the role
-- switch; the policy under test fires on the owner's insert afterwards either way.
--
-- ★ AND IT REFUSES TO PASS VACUOUSLY: if the seed did not land, there is no reviewer, and a
-- refusal would prove nothing — so it reports INCONCLUSIVE rather than PASS.
--
-- Everything rolls back.

do $$
declare v text; u uuid; c uuid; other uuid; seeded int;
begin
  -- A solo owner: the same population check (c) exercised.
  select cu.user_id, cu.company_id into u, c
  from public.company_users cu
  where cu.role = 'owner' and cu.accepted_at is not null
    and not public.company_has_reviewer(cu.company_id)
  limit 1;
  if u is null then
    raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no solo-owner company to test with';
  end if;

  -- Any OTHER real user to stand in as the accountant (user_id has an FK to public.users,
  -- so an invented uuid would fail on the constraint rather than on the policy).
  select id into other from public.users where id <> u limit 1;
  if other is null then
    raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - only one user exists, so no second person can play the accountant';
  end if;

  insert into public.company_users (company_id, user_id, role, accepted_at)
  values (c, other, 'accountant', now())
  on conflict do nothing;
  get diagnostics seeded = row_count;
  if seeded = 0 then
    raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - could not seed an accountant, so a refusal would prove nothing';
  end if;

  -- Sanity: the predicate must now SEE that reviewer. If it does not, the rest is theatre.
  if not public.company_has_reviewer(c) then
    raise exception 'CHECK RESULT (not an error): FAIL - an accountant was seeded and company_has_reviewer still says there is none';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.period_signoffs (company_id, period, signed_by, self_attested)
    values (c, '1999-04', u, true);
    v := 'FAIL - the owner self-attested even though this company now HAS an accountant; the separation is gone';
  exception
    when insufficient_privilege then v := 'PASS - refused: the moment a reviewer exists, the owner can no longer self-attest';
    when others then v := 'INCONCLUSIVE - failed for another reason: ' || SQLERRM;
  end;
  raise exception 'CHECK RESULT (not an error — this rolled back on purpose): % [ran as: %]', v, current_setting('role', true);
end $$;
