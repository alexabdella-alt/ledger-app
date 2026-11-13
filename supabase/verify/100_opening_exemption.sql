-- ═══════════════════════════════════════════════════════════════════════════════
-- 100 — Run each block ON ITS OWN; each rolls back and raises ONE verdict.
-- BEFORE 100: (A) (C) expect FAIL — the evidence. (B) (D) expect PASS before and after — the
-- legitimate opening-entry writes, which must keep working.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── (A) AN "OPENING BALANCE" DATED INSIDE A SIGNED MONTH, OFF THE CUTOFF ─────
do $$
declare v text; cid uuid; d date;
begin
  select je.company_id, je.entry_date into cid, d
  from public.journal_entries je join public.companies c on c.id = je.company_id
  where je.deleted_at is null and public.period_is_signed(je.company_id, je.entry_date)
    and (c.cutoff_date is null or je.entry_date <> c.cutoff_date) limit 1;
  if cid is null then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no signed month with a date off the cutoff'; end if;
  begin
    insert into public.journal_entries (company_id, entry_date, description, source) values (cid, d, '100 probe', 'opening_balance');
    v := 'FAIL - an entry labelled opening balance was dated into a signed month (100 closes this)';
  exception
    when check_violation then v := 'PASS - refused: ' || SQLERRM;
    when others then v := 'INCONCLUSIVE - failed for another reason: ' || SQLERRM;
  end;
  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): %', v;
end $$;

-- ── (B) AND AN OPENING ENTRY ON THE CUTOFF STILL SAVES ───────────────────────
do $$
declare v text; cid uuid; d date;
begin
  select c.id, c.cutoff_date into cid, d from public.companies c where c.cutoff_date is not null limit 1;
  if cid is null then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no company with a cutoff'; end if;
  begin
    insert into public.journal_entries (company_id, entry_date, description, source) values (cid, d, '100 probe', 'opening_balance');
    v := 'PASS - an opening entry dated on the cutoff still saves';
  exception when others then v := 'FAIL - an opening entry on the cutoff was refused: ' || SQLERRM;
  end;
  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): %', v;
end $$;

-- ── (C) THE OPENING ENTRY CANNOT BE MOVED OFF ITS CUTOFF INTO A SIGNED MONTH ──
do $$
declare v text; oid_ uuid; cid uuid; d date;
begin
  select je.id, je.company_id into oid_, cid
  from public.journal_entries je join public.companies c on c.id = je.company_id
  where je.source = 'opening_balance' and je.deleted_at is null and je.entry_date = c.cutoff_date
    and exists (select 1 from public.journal_entries x where x.company_id = je.company_id and x.deleted_at is null
                and public.period_is_signed(x.company_id, x.entry_date) and x.entry_date <> c.cutoff_date) limit 1;
  if oid_ is null then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no opening entry in a company with a signed month'; end if;
  select x.entry_date into d from public.journal_entries x join public.companies c on c.id = x.company_id
  where x.company_id = cid and x.deleted_at is null and public.period_is_signed(x.company_id, x.entry_date) and x.entry_date <> c.cutoff_date limit 1;
  begin
    update public.journal_entries set entry_date = d where id = oid_;
    v := 'FAIL - the opening entry was moved into a signed month (100 closes this)';
  exception
    when check_violation then v := 'PASS - refused: ' || SQLERRM;
    when others then v := 'INCONCLUSIVE - failed for another reason: ' || SQLERRM;
  end;
  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): %', v;
end $$;

-- ── (D) AND "REDO OPENING SETUP" CAN STILL RETIRE THE OPENING ENTRY ──────────
do $$
declare v text; oid_ uuid;
begin
  select je.id into oid_ from public.journal_entries je join public.companies c on c.id = je.company_id
  where je.source = 'opening_balance' and je.deleted_at is null and je.entry_date = c.cutoff_date limit 1;
  if oid_ is null then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no opening entry on a cutoff'; end if;
  begin
    update public.journal_entries set deleted_at = now() where id = oid_;
    v := 'PASS - the opening entry can still be retired (redo opening setup)';
  exception when others then v := 'FAIL - retiring the opening entry was refused: ' || SQLERRM;
  end;
  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): %', v;
end $$;
