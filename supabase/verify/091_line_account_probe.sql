-- ═══════════════════════════════════════════════════════════════════════════════
-- 091 / O139 — DEMONSTRATE THE HOLE, THEN PROVE THE REFUSAL. Everything rolls back.
--
-- ★★ RUN (A) BEFORE APPLYING `091`. It is expected to say FAIL, and that FAIL is the
-- evidence the migration is needed. After applying, (A) must flip to PASS and (B) must
-- PASS — (B) is the 079 direction ("it blocks too much"), the one a lazier verification
-- omits, and the one that would break every ordinary booking.
--
-- Each block borrows a real member's identity and switches to `authenticated`, because
-- the editor's own session is a superuser that bypasses RLS AND makes auth.uid() null,
-- which the trigger deliberately waves through. Every block reports the role it ran as.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── (A) CAN A MEMBER OF ONE COMPANY POINT A LINE AT ANOTHER COMPANY'S ACCOUNT? ──
-- BEFORE 091: expect FAIL. AFTER: expect PASS (refused).
do $$
declare v text; who text; u uuid; c uuid; other_acct uuid; own_acct uuid; je uuid;
begin
  select cu.user_id, cu.company_id into u, c
  from public.company_users cu
  join auth.users au on au.id = cu.user_id
  where cu.accepted_at is not null and lower(au.email) <> 'alexabdella@gmail.com'
  limit 1;
  if u is null then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no non-platform-admin member exists'; end if;
  select id into own_acct from public.accounts where company_id = c and active limit 1;
  select id into other_acct from public.accounts where company_id <> c limit 1;
  if own_acct is null or other_acct is null then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - need an account in the member''s company and one elsewhere'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  who := current_user;

  begin
    insert into public.journal_entries (company_id, entry_date, description, source, status, posted_at, created_by)
      values (c, current_date, 'O139 probe', 'manual', 'posted', now(), u) returning id into je;
    insert into public.journal_entry_lines (journal_entry_id, company_id, account_id, debit, credit)
      values (je, c, other_acct, 10, 0), (je, c, own_acct, 0, 10);
    v := 'FAIL - a line in this company''s books now points at another company''s account (this is the hole 091 closes)';
  exception
    when insufficient_privilege then v := 'PASS - refused: ' || SQLERRM;
    when others then v := 'INCONCLUSIVE - failed for another reason: ' || SQLERRM;
  end;
  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): % [ran as: %]', v, who;
end $$;

-- ── (B) AND AN ORDINARY LINE STILL INSERTS (the 079 direction) ───────────────
-- Expect PASS after 091. If this says FAIL, the guard blocks bookkeeping and must not stay.
do $$
declare v text; who text; u uuid; c uuid; a1 uuid; a2 uuid; je uuid; n int;
begin
  select cu.user_id, cu.company_id into u, c
  from public.company_users cu
  join auth.users au on au.id = cu.user_id
  where cu.accepted_at is not null and lower(au.email) <> 'alexabdella@gmail.com'
  limit 1;
  if u is null then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no non-platform-admin member exists'; end if;
  select id into a1 from public.accounts where company_id = c and active order by code limit 1;
  select id into a2 from public.accounts where company_id = c and active order by code desc limit 1;
  if a1 is null or a2 is null then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - the member''s company has no accounts'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  who := current_user;

  begin
    insert into public.journal_entries (company_id, entry_date, description, source, status, posted_at, created_by)
      values (c, current_date, 'O139 probe (same company)', 'manual', 'posted', now(), u) returning id into je;
    insert into public.journal_entry_lines (journal_entry_id, company_id, account_id, debit, credit)
      values (je, c, a1, 10, 0), (je, c, a2, 0, 10);
    get diagnostics n = row_count;
    v := case when n = 2 then 'PASS - a same-company line still inserts (2 rows)' else 'INCONCLUSIVE - inserted ' || n || ' rows' end;
  exception
    when others then v := 'FAIL - an ordinary booking was refused: ' || SQLERRM;
  end;
  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): % [ran as: %]', v, who;
end $$;
