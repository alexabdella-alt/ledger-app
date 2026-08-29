-- ═══════════════════════════════════════════════════════════════════════════════
-- O123 — REPAIR THE DUPLICATE REVERSALS, AND BACKFILL THE MARKER THAT WOULD HAVE
-- PREVENTED THEM.
--
-- NOT A MIGRATION. Lives in supabase/verify/ deliberately, and carries NO numeric
-- prefix: a file sharing a migration's number is how a duplicate `051` once caused a
-- migration to be SKIPPED. Nothing here is ever applied as part of the chain.
--
-- ── WHAT HAPPENED ─────────────────────────────────────────────────────────────
-- `reverseJournalEntry` posted with `p_meta: {kind:'reversal', reverses:<id>}`, and
-- `post_journal_entry` (migration 010) cherry-picks six named scalars out of p_meta and
-- never writes `import_metadata` at all (O95). So EVERY reversal this product has ever
-- posted has `import_metadata = NULL`, both idempotency guards have been permanently
-- false, and the display marker had nothing to read. One Hill Country invoice was
-- reversed three times — one 468.50 debit against three 468.50 credits, −937.00.
--
-- The CODE fix (C207) stamps the marker with a follow-up checked update, so this cannot
-- recur. This file deals with the rows already in the database.
--
-- ★★ RUN THE STEPS IN ORDER AND READ THE OUTPUT BETWEEN THEM. Step 3 is the only one
-- that changes a number, and it takes ids YOU paste from step 2 — it does not select its
-- own victims. Soft-deleting journal entries on a description match nobody has eyeballed
-- is precisely the blind write this repo forbids.
--
-- Each statement below is STANDALONE and returns ONE verdict row. The Supabase SQL
-- editor shows only the LAST statement's result, so run them ONE AT A TIME.
-- ═══════════════════════════════════════════════════════════════════════════════


-- ── STEP 1 — THE POPULATION. How many reversals exist, and how many carry the marker?
-- Expected before any repair: marked = 0. That IS the bug, stated as a count.
select
  count(*)                                                  as reversals_total,
  count(*) filter (where import_metadata ? 'reverses')      as marked,
  count(*) filter (where import_metadata is null)           as unmarked,
  case when count(*) filter (where import_metadata ? 'reverses') = count(*)
       then 'PASS - every reversal carries its marker'
       else 'FINDING - ' || count(*) filter (where import_metadata is null)
            || ' reversal(s) have no link back to the entry they reverse'
  end                                                       as verdict
from public.journal_entries
where description like 'REVERSAL:%'
  and status = 'posted' and deleted_at is null;


-- ── STEP 2 — WHICH ORIGINALS WERE REVERSED MORE THAN ONCE.
-- Matches on the description the reversal was built from ('REVERSAL: <original desc>',
-- with an optional ' — <reason>' tail). Read this list before running step 3; the
-- `reversal_ids` array is ordered OLDEST FIRST, so the FIRST id is the one to KEEP.
select
  o.id                                            as original_id,
  o.entry_date                                    as original_date,
  o.description                                   as original_description,
  count(r.id)                                     as reversal_count,
  array_agg(r.id order by r.created_at)           as reversal_ids_oldest_first,
  array_agg(r.created_at order by r.created_at)   as reversal_times,
  case when count(r.id) > 1
       then 'FINDING - keep the FIRST id, soft-delete the rest in step 3'
       else 'ok - single reversal'
  end                                             as verdict
from public.journal_entries o
join public.journal_entries r
  on r.company_id = o.company_id
 and r.status = 'posted' and r.deleted_at is null
 and r.description like 'REVERSAL:%'
 and split_part(substring(r.description from 11), ' — ', 1) = o.description
where o.status = 'posted' and o.deleted_at is null
  and o.description not like 'REVERSAL:%'
group by o.id, o.entry_date, o.description
having count(r.id) > 1
order by count(r.id) desc, o.entry_date;


-- ── STEP 3 — THE REPAIR. ⚠ THIS CHANGES THE BOOKS. ⚠
-- Paste the ids to REMOVE (every id from step 2's array EXCEPT the first) into the list
-- below. Soft delete only — never a hard delete (§7: recoverable, audit trail preserved).
-- Wrapped in a transaction with the verification INSIDE it: read the verdict, then COMMIT
-- or ROLLBACK yourself. Run this whole block as ONE statement.
--
-- begin;
--
--   update public.journal_entries
--      set deleted_at = now(),
--          deleted_by = '<YOUR-USER-UUID>'::uuid
--    where id in (
--            '<PASTE-EXTRA-REVERSAL-ID-1>'::uuid
--          , '<PASTE-EXTRA-REVERSAL-ID-2>'::uuid
--          )
--      and description like 'REVERSAL:%'      -- refuses to touch anything that is not a reversal
--      and deleted_at is null;
--
--   -- The verdict, computed here rather than left for the reader to interpret.
--   select
--     count(*) as still_live_extras,
--     case when count(*) = 0
--          then 'PASS - one reversal per original; COMMIT'
--          else 'FAIL - ' || count(*) || ' duplicate reversal(s) still live; ROLLBACK'
--     end as verdict
--   from (
--     select o.id
--     from public.journal_entries o
--     join public.journal_entries r
--       on r.company_id = o.company_id and r.status = 'posted' and r.deleted_at is null
--      and r.description like 'REVERSAL:%'
--      and split_part(substring(r.description from 11), ' — ', 1) = o.description
--     where o.status = 'posted' and o.deleted_at is null and o.description not like 'REVERSAL:%'
--     group by o.id having count(r.id) > 1
--   ) dupes;
--
-- rollback;   -- change to `commit;` once the verdict above reads PASS


-- ── STEP 4 — BACKFILL THE MARKER on the reversals that remain.
-- SAFE BY CONSTRUCTION: writing `import_metadata` changes no debit, no credit and no
-- balance. What it changes is that the "already reversed" guard and the on-screen
-- "Reversed" marker start working for entries posted before the code fix.
--
-- Only applies where the description match is UNAMBIGUOUS (exactly one candidate
-- original). An ambiguous one is left alone and counted — a wrong link would disable a
-- Void button on the wrong entry, which is a smaller harm than a double-post but is still
-- the machine guessing, and a guess is not what this column is for.
--
-- begin;
--
--   update public.journal_entries r
--      set import_metadata = coalesce(r.import_metadata, '{}'::jsonb)
--                            || jsonb_build_object('kind', 'reversal', 'reverses', m.original_id::text)
--     from (
--       select r2.id as reversal_id, min(o.id) as original_id
--       from public.journal_entries r2
--       join public.journal_entries o
--         on o.company_id = r2.company_id and o.status = 'posted' and o.deleted_at is null
--        and o.description not like 'REVERSAL:%'
--        and split_part(substring(r2.description from 11), ' — ', 1) = o.description
--       where r2.description like 'REVERSAL:%' and r2.status = 'posted' and r2.deleted_at is null
--         and (r2.import_metadata is null or not (r2.import_metadata ? 'reverses'))
--       group by r2.id
--       having count(distinct o.id) = 1        -- unambiguous only
--     ) m
--    where r.id = m.reversal_id;
--
--   select
--     count(*) filter (where import_metadata ? 'reverses') as marked,
--     count(*) filter (where import_metadata is null
--                        or not (import_metadata ? 'reverses')) as still_unmarked,
--     case when count(*) filter (where import_metadata ? 'reverses') > 0
--          then 'PASS - ' || count(*) filter (where import_metadata ? 'reverses')
--               || ' marked, ' || count(*) filter (where import_metadata is null
--                                                    or not (import_metadata ? 'reverses'))
--               || ' left ambiguous and untouched; COMMIT'
--          else 'FAIL - nothing was marked; ROLLBACK and check the description match'
--     end as verdict
--   from public.journal_entries
--   where description like 'REVERSAL:%' and status = 'posted' and deleted_at is null;
--
-- rollback;   -- change to `commit;` once the verdict above reads PASS


-- ── STEP 5 — CONFIRM THE MONEY. Run AFTER steps 3 and 4 are committed.
-- The whole point: the account the triple reversal distorted is back where it belongs.
-- Substitute the vendor if you are checking a different one than Hill Country.
select
  a.code, a.name,
  round(sum(l.debit) - sum(l.credit), 2) as net_movement,
  case when round(sum(l.debit) - sum(l.credit), 2) >= 0
       then 'PASS - expense account is not negative'
       else 'FAIL - still ' || round(sum(l.debit) - sum(l.credit), 2)
            || ' on the wrong side; a duplicate reversal is still live'
  end as verdict
from public.journal_entry_lines l
join public.journal_entries e on e.id = l.journal_entry_id
join public.accounts a on a.id = l.account_id
where e.status = 'posted' and e.deleted_at is null
  and (e.description ilike '%Hill Country%' or e.description ilike 'REVERSAL:%Hill Country%')
group by a.code, a.name
order by a.code;
