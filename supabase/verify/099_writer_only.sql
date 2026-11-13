-- ═══════════════════════════════════════════════════════════════════════════════
-- 099 — Run each block ON ITS OWN; each returns or raises ONE verdict.
-- BEFORE 099: (A) expects FAIL (the evidence). (B) PASS both before and after — the "blocks too
-- much" direction. (C) FAIL before, PASS after.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── (A) CAN A VIEW-ONLY TEAMMATE ADD A CONTACT? (rolls back) ─────────────────
do $$
declare v text; who text; u uuid; c uuid;
begin
  select cu.user_id, cu.company_id into u, c
  from public.company_users cu join auth.users au on au.id = cu.user_id
  where cu.accepted_at is not null and lower(au.email) <> 'alexabdella@gmail.com' limit 1;
  if u is null then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no non-platform-admin member exists to act as'; end if;
  update public.company_users set role = 'viewer' where user_id = u and company_id = c;   -- view-only, inside this rolled-back test
  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  who := current_user;
  begin
    insert into public.contacts (company_id, name, type) values (c, '099 probe ' || gen_random_uuid()::text, 'vendor');
    v := 'FAIL - a view-only teammate added a contact (099 closes this)';
  exception
    when insufficient_privilege then v := 'PASS - refused: ' || SQLERRM;
    when others then v := 'INCONCLUSIVE - failed for another reason: ' || SQLERRM;
  end;
  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): % [ran as: %]', v, who;
end $$;

-- ── (B) AND AN OWNER / ADMIN STILL CAN (rolls back) ──────────────────────────
do $$
declare v text; who text; u uuid; c uuid;
begin
  select cu.user_id, cu.company_id into u, c
  from public.company_users cu join auth.users au on au.id = cu.user_id
  where cu.accepted_at is not null and cu.role in ('owner','admin') and lower(au.email) <> 'alexabdella@gmail.com' limit 1;
  if u is null then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no non-platform-admin owner/admin exists to act as'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  who := current_user;
  begin
    insert into public.contacts (company_id, name, type) values (c, '099 probe ' || gen_random_uuid()::text, 'vendor');
    v := 'PASS - an owner/admin still adds a contact';
  exception when others then v := 'FAIL - an owner/admin was refused: ' || SQLERRM;
  end;
  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): % [ran as: %]', v, who;
end $$;

-- ── (C) EVERY WRITE RULE ON THE SIX TABLES NEEDS A WRITER; DELETING AN ANOMALY NEEDS A REVIEWER; ONE RULE PER COMMAND (read-only) ──
select case
  when exists (select 1 from pg_policies where schemaname = 'public'
               and tablename in ('accounts','contacts','vendor_rules','bank_accounts','documents','document_intake') and cmd in ('INSERT','UPDATE','DELETE')
               and coalesce(qual, '') || coalesce(with_check, '') not like '%is_company_writer(company_id)%')
    then 'FAIL - a write rule on a setup table still lets any member through'
  when not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'anomalies' and cmd = 'DELETE' and qual like '%is_company_reviewer(company_id)%')
    then 'FAIL - deleting an anomaly does not need a reviewer'
  when exists (select 1 from pg_policies where schemaname = 'public'
               and tablename in ('accounts','contacts','vendor_rules','bank_accounts','documents','document_intake','anomalies') and permissive = 'PERMISSIVE'
               group by tablename, cmd having count(*) > 1)
    then 'FAIL - a table has two rules for one command (the looser one would win)'
  else 'PASS - the six setup tables need a writer to change, deleting an anomaly needs a reviewer, and each has one rule per command'
end as verdict;
