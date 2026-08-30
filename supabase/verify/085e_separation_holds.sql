-- VERIFY (e) — ★★ AND THE SEPARATION STILL HOLDS WHERE IT MATTERS: an owner of a company that
-- HAS an accountant is still refused. This is the "did it block too much / too little?" check
-- in the direction that would quietly destroy the product's whole point.
--

do $$
declare v text; u uuid; c uuid;
begin
  select cu.user_id, cu.company_id into u, c
  from public.company_users cu
  where cu.role = 'owner' and cu.accepted_at is not null
    and public.company_has_reviewer(cu.company_id)
  limit 1;
  if u is null then
    raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no company with BOTH an owner and a reviewer exists to test with';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.period_signoffs (company_id, period, signed_by, self_attested)
    values (c, '1999-03', u, true);
    v := 'FAIL - an owner self-attested even though this company HAS an accountant';
  exception
    when insufficient_privilege then v := 'PASS - refused: the separation still holds where a reviewer exists';
    when others then v := 'INCONCLUSIVE - failed for another reason: ' || SQLERRM;
  end;
  raise exception 'CHECK RESULT (not an error — this rolled back on purpose): % [ran as: %]', v, current_setting('role', true);
end $$;
