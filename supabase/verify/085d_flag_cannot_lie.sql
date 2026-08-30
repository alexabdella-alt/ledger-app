-- VERIFY (d) — ★★★ THE FLAG CANNOT LIE: the SAME owner may NOT write self_attested = false.
-- Without this, (c) passing is equally consistent with "we let owners record an accountant's
-- review that never happened".
--

do $$
declare v text; u uuid; c uuid;
begin
  select cu.user_id, cu.company_id into u, c
  from public.company_users cu
  where cu.role = 'owner' and cu.accepted_at is not null
    and not public.company_has_reviewer(cu.company_id)
  limit 1;
  if u is null then
    raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no solo-owner company exists to test with';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.period_signoffs (company_id, period, signed_by, self_attested)
    values (c, '1999-02', u, false);
    v := 'FAIL - an owner recorded a sign-off as a REVIEWER review; the flag can lie';
  exception
    when insufficient_privilege then v := 'PASS - refused: an owner cannot record their sign-off as a reviewer''s';
    when others then v := 'INCONCLUSIVE - failed for another reason: ' || SQLERRM;
  end;
  raise exception 'CHECK RESULT (not an error — this rolled back on purpose): % [ran as: %]', v, current_setting('role', true);
end $$;
