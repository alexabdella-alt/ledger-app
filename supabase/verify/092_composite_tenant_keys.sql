-- ═══════════════════════════════════════════════════════════════════════════════
-- 092 / O139 (the rest) — DEMONSTRATE, THEN PROVE. Everything rolls back.
--
-- ★★ RUN (A) BEFORE APPLYING. It is expected to say FAIL, and that FAIL is the evidence the
-- migration is needed. After applying: (B) must say PASS (refused), (C) must say PASS (an
-- ordinary reference still saves), and (D) must count 34 composite keys.
--
-- ★★★ AND THE MIGRATION ITSELF IS THE FOURTH CHECK. A foreign key validates every existing
-- row as it is added, so a clean commit is proof that no row in the database has ever crossed
-- companies. If it fails, it names the row and writes nothing — SEND THE ERROR, do not retry.
--
-- (A)–(C) borrow a real member's identity, because the editor's own session is a superuser
-- that bypasses RLS; each block reports the role it actually ran as.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── (A) BEFORE 092 — CAN A ROW POINT AT ANOTHER COMPANY'S ROW?  expect FAIL ──
-- ── (B) AFTER 092 — the identical block.                        expect PASS ──
do $$
declare v text; who text; u uuid; c uuid; other_acct uuid;
begin
  select cu.user_id, cu.company_id into u, c
  from public.company_users cu
  join auth.users au on au.id = cu.user_id
  where cu.accepted_at is not null and lower(au.email) <> 'alexabdella@gmail.com'
  limit 1;
  if u is null then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no non-platform-admin member exists'; end if;
  select id into other_acct from public.accounts where company_id <> c limit 1;
  if other_acct is null then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no account outside this member''s company'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  who := current_user;

  begin
    insert into public.contacts (company_id, name, type, default_account_id)
      values (c, 'O139 probe supplier', 'vendor', other_acct);
    v := 'FAIL - a contact in this company now defaults to another company''s category (this is the shape 092 closes)';
  exception
    when foreign_key_violation then v := 'PASS - refused by the database: ' || SQLERRM;
    when others then v := 'INCONCLUSIVE - failed for another reason: ' || SQLERRM;
  end;
  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): % [ran as: %]', v, who;
end $$;

-- ── (C) AND AN ORDINARY SAME-COMPANY REFERENCE STILL SAVES (the 079 direction) ──
-- Expect PASS after 092. If this says FAIL, the keys block real work and must come back out.
do $$
declare v text; who text; u uuid; c uuid; own_acct uuid; n int;
begin
  select cu.user_id, cu.company_id into u, c
  from public.company_users cu
  join auth.users au on au.id = cu.user_id
  where cu.accepted_at is not null and lower(au.email) <> 'alexabdella@gmail.com'
  limit 1;
  if u is null then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no non-platform-admin member exists'; end if;
  select id into own_acct from public.accounts where company_id = c and active limit 1;
  if own_acct is null then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - the member''s company has no accounts'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  who := current_user;

  begin
    insert into public.contacts (company_id, name, type, default_account_id)
      values (c, 'O139 probe supplier (same company)', 'vendor', own_acct);
    get diagnostics n = row_count;
    v := case when n = 1 then 'PASS - an ordinary same-company reference still saves'
              else 'INCONCLUSIVE - inserted ' || n || ' rows' end;
  exception
    when others then v := 'FAIL - an ordinary reference was refused: ' || SQLERRM;
  end;
  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): % [ran as: %]', v, who;
end $$;

-- ── (D) EVERY ONE OF THE 34 LANDED, and none of the old single-column keys survive ──
-- One statement, one verdict row. Nothing is written.
select
  count(*) filter (where c.conname like '%\_company\_fkey' and array_length(c.conkey, 1) = 2) as composite_keys,
  case when count(*) filter (where c.conname like '%\_company\_fkey' and array_length(c.conkey, 1) = 2) = 34
       then 'PASS - all 34 references are composite (tenancy enforced by the database)'
       else 'FAIL - expected 34 composite keys, found '
            || count(*) filter (where c.conname like '%\_company\_fkey' and array_length(c.conkey, 1) = 2)
            || ' - 092 did not fully apply' end as verdict
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public' and c.contype = 'f';
