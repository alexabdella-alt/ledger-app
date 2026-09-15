-- ═══════════════════════════════════════════════════════════════════════════════
-- 091 — A JOURNAL LINE MAY ONLY POINT AT AN ACCOUNT OF ITS OWN COMPANY. (O139)
--
-- ★★★ FOUND FROM THE CLIENT SIDE (C416). `useAccounts` kept the previous company's chart in
-- memory across a company switch until the next read resolved, so in that window a booking
-- resolved every role against the LAST company's accounts — and the write would have
-- SUCCEEDED: `post_journal_entry` (010) checks that the caller is a member of `p_company_id`
-- and that the lines balance, and NEVER that each `account_id` belongs to that company.
-- `journal_entry_lines`' RLS checks the LINE's `company_id`, not the account's. So a member
-- of company B can write a line into B's books that points at an account owned by A —
-- through the client (C416 closed the accidental route), through the QuickBooks importer's
-- direct insert, or through a hand-made call with any account uuid (a uuid is not a secret
-- and not a boundary — 081's own words).
--
-- ★★ THE CONSEQUENCE IS NOT A LEAK OF A's DATA. IT IS A LINE IN B's LEDGER THAT B's CHART
-- CANNOT EXPLAIN: `flattenJournalEntries` resolves account ids against the company's own
-- chart, so the leg reads as an unknown code, drops out of every role-derived report, and
-- the trial balance would not tie to anything a person could point at. The 081 shape once
-- more: a covered table whose rule permits something no policy author intended.
--
-- ★ A TRIGGER, NOT A CHANGE TO `post_journal_entry`. §6 forbids rewriting a live function
-- from the repo (five definitions of one seed function, the newest never applied); a
-- BEFORE INSERT trigger on the lines table is standalone, needs no `pg_get_functiondef`
-- copy, and covers the RPC, the QBO importer's direct insert, and any future writer at
-- once. It applies on UPDATE of `account_id` too, so a recode cannot re-point a line
-- off-company. A migration or service-role write (auth.uid() null) passes — 053 and 081's
-- convention — because the guard is about what a PERSON may reference, and a backfill
-- carries its own review.
--
-- VERIFY: supabase/verify/091_line_account_probe.sql — run (A) BEFORE applying (expect
-- FAIL: the hole is demonstrated), then apply, then (A) again (PASS: refused) and (B)
-- (PASS: a same-company line still inserts — the 079 direction).
-- ═══════════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.guard_line_account_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_acct_company uuid;
begin
  if auth.uid() is null then return NEW; end if;   -- migration / service role: not a person
  if TG_OP = 'UPDATE' and NEW.account_id is not distinct from OLD.account_id then return NEW; end if;

  select company_id into v_acct_company from public.accounts where id = NEW.account_id;
  if v_acct_company is null then
    raise exception 'That category does not exist.' using errcode = 'foreign_key_violation';
  end if;
  if v_acct_company <> NEW.company_id then
    raise exception 'That category belongs to a different company, so this entry cannot use it.'
      using errcode = 'insufficient_privilege';
  end if;
  return NEW;
end $$;

drop trigger if exists guard_line_account_company on public.journal_entry_lines;
create trigger guard_line_account_company
  before insert or update of account_id on public.journal_entry_lines
  for each row execute function public.guard_line_account_company();

commit;
