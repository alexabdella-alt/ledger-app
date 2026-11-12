-- ═══════════════════════════════════════════════════════════════════════════════
-- 095 — AN ENTRY BALANCES BECAUSE THE DATABASE SAYS SO, NOT BECAUSE THE CALLER DID.
-- ▶ HOLD — written 2026-11-12 from the repo, NOT applied. Run the probe's (A) and (0) first.
--
-- "Debits = credits" is checked in exactly one place: inside `post_journal_entry` (010).
-- But `jel_insert` / `jel_update` let any owner, admin or accountant write the lines table
-- DIRECTLY, and a direct write is checked by nothing. Two client paths did exactly that:
-- the QuickBooks importer (header insert, then lines, the lines' error never read) and a
-- "legacy" fallback in `persistJournalEntry` that returned the entry's id even when its
-- lines were refused. Both are fixed in the client in the same change — and that is the
-- point: the client was the only thing standing there. A hand-made request with a valid
-- session needs no client at all (081: a uuid is not a boundary; neither is a browser).
--
-- THE GUARD: a DEFERRED constraint trigger. Deferred, because an entry is legitimately
-- unbalanced BETWEEN its first line and its last; it must balance when the transaction
-- commits. One PostgREST request is one transaction, so a single multi-row insert of both
-- legs passes, and `post_journal_entry` (header + lines in one function call) passes.
--
-- WHAT FIRES IT: insert, delete, and update of debit / credit / journal_entry_id ONLY.
-- Stamping `project` on a line (C-series, `stampLineProject`) moves no money and does not
-- fire it — so a pre-existing unbalanced entry can still be tagged; it just cannot be made
-- differently unbalanced. Deleting an entry (lines cascade) leaves 0 = 0 and passes.
--
-- NO SERVICE-ROLE EXEMPTION, unlike 091. 091 waved through `auth.uid() is null` because a
-- cross-company reference is a question of WHO; balance is not. An unbalanced entry is
-- wrong whoever writes it, a migration included.
--
-- STANDALONE: creates one new function and one trigger. It does not `create or replace`
-- any live function, so §6's pg_get_functiondef rule is not in play.
--
-- VERIFY: supabase/verify/095_balance_trigger_probe.sql
-- ROLLBACK: drop trigger journal_entry_lines_balance on public.journal_entry_lines;
--           drop function public.journal_entry_must_balance();
-- ═══════════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.journal_entry_must_balance()
returns trigger
language plpgsql
security definer                      -- the sum must see every line, whatever RLS shows the caller
set search_path = public, pg_temp
as $$
declare
  v_entry uuid;
  v_debit numeric;
  v_credit numeric;
begin
  -- An update that MOVES a line between entries has to leave both entries balanced.
  foreach v_entry in array array_remove(array[
      case when tg_op in ('INSERT', 'UPDATE') then new.journal_entry_id end,
      case when tg_op in ('UPDATE', 'DELETE') then old.journal_entry_id end
    ], null)
  loop
    select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
      into v_debit, v_credit
      from public.journal_entry_lines
     where journal_entry_id = v_entry;
    if v_debit <> v_credit then
      raise exception 'journal entry not balanced: debits % <> credits % (entry %)', v_debit, v_credit, v_entry
        using errcode = '23514';        -- check_violation: the same class a CHECK would raise
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.journal_entry_must_balance() from public, anon, authenticated;

drop trigger if exists journal_entry_lines_balance on public.journal_entry_lines;
create constraint trigger journal_entry_lines_balance
  after insert or delete or update of debit, credit, journal_entry_id
  on public.journal_entry_lines
  deferrable initially deferred
  for each row execute function public.journal_entry_must_balance();

commit;
