-- VERIFY (c) — ★★ THE POINT OF THE WHOLE MIGRATION: a solo owner CAN now sign, with the flag.
-- Borrows a real owner of a company that has no admin/accountant. Rolled back.
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
    values (c, '1999-01', u, true);
    v := 'PASS - a solo owner signed their own books, with self_attested recorded';
  exception
    when insufficient_privilege then v := 'FAIL - still refused: ' || SQLERRM;
    when others then v := 'INCONCLUSIVE - failed for another reason: ' || SQLERRM;
  end;
  raise exception 'CHECK RESULT (not an error — this rolled back on purpose): % [ran as: %]', v, current_setting('role', true);
end $$;
