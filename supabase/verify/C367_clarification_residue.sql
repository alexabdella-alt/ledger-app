-- C367 — INTAKE ROWS HELD "awaiting clarification" WHOSE QUESTION WAS ANSWERED BEFORE THE FIX.
--
-- Before C367 (2026-09-14) an answered clarification card never advanced the document's
-- intake row, so every such row still reads "awaiting clarification in review queue".
-- The app now excludes any whose document is linked to an entry (proof of a booking), so
-- nothing on screen re-asks them. This census counts the residue; the repair (commented,
-- the operator's) marks the PROVABLY answered ones recorded. Rows whose document has no
-- link cannot be told apart from a genuinely unanswered question and are LEFT — they will
-- be offered again, which costs one click and books nothing twice.
--
-- One statement per check; each returns a single verdict row (CLAUDE.md §6).

-- (a) the residue, by company
select
  i.company_id,
  count(*)                                              as held_awaiting,
  count(*) filter (where d.linked_invoice_id is not null) as provably_answered,
  count(*) filter (where d.linked_invoice_id is null)     as cannot_tell
from public.document_intake i
left join public.documents d on d.id = i.document_id
where i.status = 'held_for_review'
  and i.detail = 'awaiting clarification in review queue'
group by i.company_id
order by held_awaiting desc;

-- (b) REPAIR — operator's, run only after reading (a). Marks the provably answered rows
-- RECORDED with the entry their document is linked to. Idempotent.
-- update public.document_intake i
--    set status = 'recorded',
--        journal_entry_ids = array[d.linked_invoice_id::text],
--        detail = 'recorded after your answer (repaired: the row predates C367)',
--        updated_at = now()
--   from public.documents d
--  where d.id = i.document_id
--    and d.linked_invoice_id is not null
--    and i.status = 'held_for_review'
--    and i.detail = 'awaiting clarification in review queue';

-- (c) after the repair: nothing provably answered is still held
select case when count(*) = 0
  then 'PASS - no held-awaiting row has a document already linked to an entry'
  else 'FAIL - ' || count(*) || ' row(s) still held over a booked document' end as verdict
from public.document_intake i
join public.documents d on d.id = i.document_id
where i.status = 'held_for_review'
  and i.detail = 'awaiting clarification in review queue'
  and d.linked_invoice_id is not null;
