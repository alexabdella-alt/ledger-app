-- ═══════════════════════════════════════════════════════════════════════════════
-- 095 — DEMONSTRATE THE HOLE, THEN PROVE THE REFUSAL. Run each block ON ITS OWN.
--
-- ★★ RUN (0) AND (A) BEFORE APPLYING `095`. (A) is expected to say FAIL — that red is the
-- evidence the migration is needed. After applying: (A) must flip to PASS, and (B) and (C)
-- must PASS. (B) is the 079 direction — "it blocks too much" — and (C) is the one a tired
-- verification skips: the real booking function still works.
--
-- (A)-(C) end in a deliberate exception so everything rolls back; the verdict is in the
-- message. `set constraints ... immediate` is what makes a DEFERRED check answer inside
-- the block instead of at a commit that never comes.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── (0) HOW MANY LIVE ENTRIES ARE UNBALANCED TODAY? (read-only; informational) ──
-- Not a pass/fail on the migration: 095 only governs writes from now on. But a non-zero
-- count here is its own finding and wants a repair before anyone signs those months.
select case when count(*) = 0
  then 'CLEAN - every live entry with lines balances'
  else 'FOUND - ' || count(*) || ' live entries do not balance (oldest ' || min(entry_date) || ', newest ' || max(entry_date) || ')'
end as verdict
from (
  select je.id, je.entry_date
  from public.journal_entries je
  join public.journal_entry_lines l on l.journal_entry_id = je.id
  where je.deleted_at is null
  group by je.id, je.entry_date
  having sum(l.debit) <> sum(l.credit)
) t;

-- ── (A) CAN A ONE-SIDED ENTRY BE WRITTEN STRAIGHT INTO THE LINES TABLE? ──────
-- BEFORE 095: expect FAIL. AFTER: expect PASS (refused).
do $$
declare v text; c uuid; a1 uuid; je uuid;
begin
  select company_id into c from public.accounts where active group by company_id order by count(*) desc limit 1;
  select id into a1 from public.accounts where company_id = c and active order by code limit 1;
  if a1 is null then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no company with an active account'; end if;
  begin
    insert into public.journal_entries (company_id, entry_date, description, source, status, posted_at)
      values (c, current_date, '095 probe (one-sided)', 'manual', 'posted', now()) returning id into je;
    insert into public.journal_entry_lines (journal_entry_id, company_id, account_id, debit, credit)
      values (je, c, a1, 10, 0);
    if exists (select 1 from pg_trigger where tgname = 'journal_entry_lines_balance') then
      set constraints journal_entry_lines_balance immediate;
    end if;
    v := 'FAIL - a one-sided entry (debit 10, credit 0) was accepted (this is the hole 095 closes)';
  exception
    when check_violation then v := 'PASS - refused: ' || SQLERRM;
    when others then v := 'INCONCLUSIVE - failed for another reason: ' || SQLERRM;
  end;
  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): %', v;
end $$;

-- ── (B) AND A BALANCED DIRECT INSERT STILL LANDS (the 079 direction) ─────────
-- Expect PASS after 095. If this says FAIL, the guard blocks bookkeeping and must not stay.
do $$
declare v text; c uuid; a1 uuid; a2 uuid; je uuid; n int;
begin
  select company_id into c from public.accounts where active group by company_id order by count(*) desc limit 1;
  select id into a1 from public.accounts where company_id = c and active order by code limit 1;
  select id into a2 from public.accounts where company_id = c and active order by code desc limit 1;
  if a1 is null or a2 is null or a1 = a2 then raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - need two active accounts in one company'; end if;
  begin
    insert into public.journal_entries (company_id, entry_date, description, source, status, posted_at)
      values (c, current_date, '095 probe (balanced)', 'manual', 'posted', now()) returning id into je;
    insert into public.journal_entry_lines (journal_entry_id, company_id, account_id, debit, credit)
      values (je, c, a1, 10, 0), (je, c, a2, 0, 10);
    get diagnostics n = row_count;
    if exists (select 1 from pg_trigger where tgname = 'journal_entry_lines_balance') then
      set constraints journal_entry_lines_balance immediate;
    end if;
    -- and a line can still be tagged without re-opening the question
    update public.journal_entry_lines set project = '095 probe' where journal_entry_id = je;
    v := case when n = 2 then 'PASS - a balanced two-line entry inserts and can be tagged' else 'INCONCLUSIVE - inserted ' || n || ' rows' end;
  exception
    when others then v := 'FAIL - an ordinary balanced entry was refused: ' || SQLERRM;
  end;
  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): %', v;
end $$;

-- ── (C) IS THE GUARD ACTUALLY INSTALLED, DEFERRED, AND ON THE RIGHT EVENTS? ──
-- Read-only. Expect PASS after 095.
select case
  when not exists (select 1 from pg_trigger where tgname = 'journal_entry_lines_balance' and tgrelid = 'public.journal_entry_lines'::regclass)
    then 'FAIL - the trigger is not installed'
  when exists (select 1 from pg_trigger where tgname = 'journal_entry_lines_balance' and tgrelid = 'public.journal_entry_lines'::regclass
                and tgenabled <> 'D' and tgdeferrable and tginitdeferred)
    then 'PASS - journal_entry_lines_balance is installed, enabled, and deferred to commit'
  else 'FAIL - the trigger exists but is disabled or not deferred'
end as verdict;
