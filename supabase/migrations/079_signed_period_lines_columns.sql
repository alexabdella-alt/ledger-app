-- 079 — THE SIGNED-PERIOD GUARD WAS BLOCKING A CHANGE THAT MOVES NO MONEY.
--
-- ── WHAT `078` GOT WRONG, FOUND THE SAME DAY BY ITS OWN RULE ──────────────────
-- `078` (this morning) applies column-level discrimination to `journal_entries` — only
-- `entry_date`, `status` and `deleted_at` are protected, so amount-free metadata like
-- `payment_status` stays writable and a CPA can still record a payment against last
-- quarter's invoice. **The lines trigger got no such discrimination.** It refuses ANY
-- update to `journal_entry_lines` in a signed month.
--
-- ★ SO RETAGGING A PROJECT ON A SIGNED MONTH'S ENTRY IS REFUSED. `persistChatRetagProject`
-- updates `journal_entry_lines.project` — an analytics label that changes no debit, no
-- credit and no account. A signature attests to the NUMBERS; it does not freeze how the
-- work is filed for reporting.
--
-- ★★ AND THIS IS THE FAILURE `078`'s OWN VERIFICATION NAMED AS THE DANGEROUS ONE. Its
-- check (5) exists because, for a guard, "it doesn't block" is the obvious failure and the
-- unlikely one, while "it blocks too much" breaks ordinary work and surfaces only when
-- someone tries to do their job. Check (5) proved an open month still accepts ENTRIES. It
-- did not test a metadata-only LINE update in a signed month, so this slipped through the
-- verification that was written to catch exactly it.
--
-- Found by applying `078`'s own recorded rule — *when adding a refusal, grep every caller
-- of the thing it now refuses* — rather than by a failure report.
--
-- ── WHAT CHANGES ──────────────────────────────────────────────────────────────
-- INSERT and DELETE of a line stay blocked unconditionally: adding or removing a line
-- changes the entry's totals. UPDATE is now blocked only when it touches money:
--   · `account_id`  — moves the amount to a different account (this is a recode)
--   · `debit` / `credit` — the amounts themselves
-- `project`, `memo` and anything else amount-free stay writable, matching how `078`
-- already treats the entries table.
--
-- Idempotent — replaces the function in place; the trigger binding is unchanged.

begin;

create or replace function public.guard_signed_period_lines()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare e record;
begin
  -- ★ AN UPDATE THAT MOVES NO MONEY IS NOT THE SIGNATURE'S BUSINESS. Checked FIRST, so a
  -- metadata-only write does not even look up the period — cheaper, and it makes the
  -- exemption obvious rather than buried under the period logic.
  if (TG_OP = 'UPDATE')
     and NEW.account_id is not distinct from OLD.account_id
     and NEW.debit      is not distinct from OLD.debit
     and NEW.credit     is not distinct from OLD.credit then
    return NEW;
  end if;

  select company_id, entry_date, source into e
  from public.journal_entries
  where id = coalesce(NEW.journal_entry_id, OLD.journal_entry_id);

  -- No parent ⇒ a cascade from the entry's own deletion, which the entries trigger has
  -- already ruled on. Blocking here too would make a legitimate delete of an OPEN entry
  -- fail on its own children.
  if not found then return coalesce(NEW, OLD); end if;

  if coalesce(e.source, '') <> 'opening_balance'
     and public.period_is_signed(e.company_id, e.entry_date) then
    raise exception '%', public.signed_period_error(e.entry_date)
      using errcode = 'check_violation';
  end if;
  return coalesce(NEW, OLD);
end $$;

commit;


-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFY — ONE STANDALONE STATEMENT PER CHECK. Run them ONE AT A TIME (§6).
--
-- ▶ (b) and (c) report through `raise exception`, which Supabase renders in RED under
-- "Failed to run sql query". `P0001` means a function raised it deliberately. The message
-- LEADS with that, per §6 — read it, it is the result.
-- ═══════════════════════════════════════════════════════════════════════════════

-- VERIFY (a) — the function body carries the new exemption.
--
-- select
--   case when pg_get_functiondef(oid) like '%is not distinct from OLD.account_id%'
--        then 'PASS - metadata-only line updates are exempt'
--        else 'FAIL - the old body is still installed'
--   end as verdict
-- from pg_proc where proname = 'guard_signed_period_lines';


-- VERIFY (b) — ★ THE REGRESSION ITSELF: a project retag inside a signed month SUCCEEDS.
-- This is the check `078` should have had. Rolled back either way.
--
-- do $$
-- declare v text; l record;
-- begin
--   select jel.id, jel.project into l
--   from public.journal_entry_lines jel
--   join public.journal_entries je on je.id = jel.journal_entry_id
--   where je.deleted_at is null
--     and coalesce(je.source,'') <> 'opening_balance'
--     and public.period_is_signed(je.company_id, je.entry_date)
--   limit 1;
--   if l.id is null then
--     raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no line inside a signed month to test';
--   end if;
--   begin
--     update public.journal_entry_lines set project = 'verify-079' where id = l.id;
--     v := 'PASS - a project retag in a signed month is allowed';
--   exception when others then v := 'FAIL - still blocked: ' || SQLERRM;
--   end;
--   raise exception 'CHECK RESULT (not an error — this rolled back on purpose): %', v;
-- end $$;


-- VERIFY (c) — ★★ AND THE MONEY IS STILL PROTECTED. Without this, (b) passing is equally
-- consistent with "we exempted metadata" and "we switched the guard off".
--
-- do $$
-- declare v text; l record;
-- begin
--   select jel.id, jel.debit into l
--   from public.journal_entry_lines jel
--   join public.journal_entries je on je.id = jel.journal_entry_id
--   where je.deleted_at is null
--     and coalesce(je.source,'') <> 'opening_balance'
--     and public.period_is_signed(je.company_id, je.entry_date)
--   limit 1;
--   if l.id is null then
--     raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no line inside a signed month to test';
--   end if;
--   begin
--     update public.journal_entry_lines set debit = coalesce(l.debit,0) + 1 where id = l.id;
--     v := 'FAIL - an AMOUNT was changed inside a signed month';
--   exception
--     when check_violation then v := 'PASS - the amount change was refused';
--     when others then v := 'INCONCLUSIVE - failed for another reason: ' || SQLERRM;
--   end;
--   raise exception 'CHECK RESULT (not an error — this rolled back on purpose): %', v;
-- end $$;
