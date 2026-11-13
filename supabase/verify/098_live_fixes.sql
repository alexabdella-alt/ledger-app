-- ═══════════════════════════════════════════════════════════════════════════════
-- 098 — DEMONSTRATE EACH PROBLEM, THEN PROVE IT IS FIXED. Run each block ON ITS OWN; each
-- ends in a deliberate exception so nothing it tries survives — the verdict is in the message.
--
-- BEFORE 098: (A) (B) (D) expect FAIL — the evidence. (C) (E) expect PASS — the "it blocks
-- too much" direction, which must STILL pass after 098.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── (A) S6 — CAN AN ACCOUNTANT INVITE BE ACCEPTED? ───────────────────────────
do $$
declare v text; who text; u uuid; em text; other uuid; tok uuid; r text;
begin
  select cu.user_id, au.email into u, em
  from public.company_users cu join auth.users au on au.id = cu.user_id
  where cu.accepted_at is not null and lower(au.email) <> 'alexabdella@gmail.com' limit 1;
  if u is null then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no non-platform-admin member exists to act as'; end if;
  select co.id into other from public.companies co
  where not exists (select 1 from public.company_users x where x.company_id = co.id and x.user_id = u) limit 1;
  if other is null then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no company to invite them into'; end if;
  insert into public.company_invites (company_id, email, role, invited_by) values (other, em, 'accountant', u) returning token into tok;

  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  who := current_user;
  begin
    perform public.accept_invite(tok);
    select cu.role into r from public.company_users cu where cu.company_id = other and cu.user_id = u;
    v := case when r = 'accountant' then 'PASS - an accountant invite was accepted, as accountant'
              else 'FAIL - accepted, but the membership is ' || coalesce(r, '(none visible)') end;
  exception when others then v := 'FAIL - an accountant invite could not be accepted: ' || SQLERRM;
  end;
  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): % [ran as: %]', v, who;
end $$;

-- ── (B) S5 — CAN A LINE BE MOVED OUT OF A SIGNED-OFF MONTH? ──────────────────
do $$
declare v text; ln uuid; cid uuid; dst uuid;
begin
  select l.id, je.company_id into ln, cid
  from public.journal_entry_lines l join public.journal_entries je on je.id = l.journal_entry_id
  where je.deleted_at is null and coalesce(je.source,'') <> 'opening_balance'
    and public.period_is_signed(je.company_id, je.entry_date) limit 1;
  if ln is null then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no line in a signed-off month'; end if;
  select je.id into dst from public.journal_entries je
  where je.company_id = cid and je.deleted_at is null and coalesce(je.source,'') <> 'opening_balance'
    and not public.period_is_signed(je.company_id, je.entry_date) limit 1;
  if dst is null then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no open-month entry to move it to'; end if;
  begin
    update public.journal_entry_lines set journal_entry_id = dst where id = ln;
    v := 'FAIL - a line was moved out of a signed-off month into an open one (098 closes this)';
  exception
    when check_violation then v := 'PASS - refused: ' || SQLERRM;
    when others then v := 'INCONCLUSIVE - failed for another reason: ' || SQLERRM;
  end;
  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): %', v;
end $$;

-- ── (C) S5 — AND A LINE MOVED BETWEEN TWO OPEN-MONTH ENTRIES STILL SAVES ─────
do $$
declare v text; ln uuid; cid uuid; src uuid; dst uuid;
begin
  select l.id, je.company_id, je.id into ln, cid, src
  from public.journal_entry_lines l join public.journal_entries je on je.id = l.journal_entry_id
  where je.deleted_at is null and coalesce(je.source,'') <> 'opening_balance'
    and not public.period_is_signed(je.company_id, je.entry_date) limit 1;
  if ln is null then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no line in an open month'; end if;
  select je.id into dst from public.journal_entries je
  where je.company_id = cid and je.id <> src and je.deleted_at is null and coalesce(je.source,'') <> 'opening_balance'
    and not public.period_is_signed(je.company_id, je.entry_date) limit 1;
  if dst is null then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no second open-month entry'; end if;
  begin
    update public.journal_entry_lines set journal_entry_id = dst where id = ln;
    v := 'PASS - a line moved between two open-month entries still saves';
  exception when others then v := 'FAIL - an open-month move was refused: ' || SQLERRM;
  end;
  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): %', v;
end $$;

-- ── (D) S4 — CAN A VIEW-ONLY MEMBER RECORD AN ENTRY? ─────────────────────────
do $$
declare v text; who text; u uuid; c uuid; a1 uuid; a2 uuid;
begin
  select cu.user_id, cu.company_id into u, c
  from public.company_users cu join auth.users au on au.id = cu.user_id
  where cu.accepted_at is not null and lower(au.email) <> 'alexabdella@gmail.com' limit 1;
  if u is null then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no non-platform-admin member exists to act as'; end if;
  select id into a1 from public.accounts where company_id = c and code like '6%' limit 1;
  select id into a2 from public.accounts where company_id = c and code like '10%' limit 1;
  if a1 is null or a2 is null then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - the company has no expense or cash category'; end if;
  update public.company_users set role = 'viewer' where user_id = u and company_id = c;   -- made view-only, inside this rolled-back test

  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  who := current_user;
  begin
    perform public.post_journal_entry(p_company_id => c, p_entry_date => current_date, p_description => '098 probe', p_source => 'manual',
      p_created_by => u, p_lines => jsonb_build_array(jsonb_build_object('account_id', a1, 'debit', 1, 'credit', 0),
                                                       jsonb_build_object('account_id', a2, 'debit', 0, 'credit', 1)), p_meta => '{}'::jsonb);
    v := 'FAIL - a view-only member recorded an entry (098 closes this)';
  exception
    when insufficient_privilege then v := 'PASS - refused: ' || SQLERRM;
    when others then v := 'INCONCLUSIVE - failed for another reason: ' || SQLERRM;
  end;
  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): % [ran as: %]', v, who;
end $$;

-- ── (E) S4 — AND AN OWNER / ADMIN STILL RECORDS ENTRIES ──────────────────────
do $$
declare v text; who text; u uuid; c uuid; a1 uuid; a2 uuid;
begin
  select cu.user_id, cu.company_id into u, c
  from public.company_users cu join auth.users au on au.id = cu.user_id
  where cu.accepted_at is not null and cu.role in ('owner','admin') and lower(au.email) <> 'alexabdella@gmail.com' limit 1;
  if u is null then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no non-platform-admin owner/admin exists to act as'; end if;
  select id into a1 from public.accounts where company_id = c and code like '6%' limit 1;
  select id into a2 from public.accounts where company_id = c and code like '10%' limit 1;
  if a1 is null or a2 is null then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - the company has no expense or cash category'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  who := current_user;
  begin
    perform public.post_journal_entry(p_company_id => c, p_entry_date => current_date, p_description => '098 probe', p_source => 'manual',
      p_created_by => u, p_lines => jsonb_build_array(jsonb_build_object('account_id', a1, 'debit', 1, 'credit', 0),
                                                       jsonb_build_object('account_id', a2, 'debit', 0, 'credit', 1)), p_meta => '{}'::jsonb);
    v := 'PASS - an owner/admin still records entries';
  exception when others then v := 'FAIL - an owner/admin was refused: ' || SQLERRM;
  end;
  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): % [ran as: %]', v, who;
end $$;
