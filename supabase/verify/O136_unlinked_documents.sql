-- O136 — invoice documents stored UNLINKED since C300 (2026-09-01). Read-only census, then
-- one backfill that only touches rows whose link is KNOWN from the intake ledger.
-- One standalone statement per check; each returns a single verdict row.
--
-- WHY: O97's durable-first store writes the row before classification (link null); the
-- invoice path's second storeDocument on the same bytes hit C193's dedupe, which stamped
-- the TYPE (C300) and never the LINK. Fixed in the client (C324). This is the live residue.

-- (a) CENSUS — how many invoice/receipt documents carry no link, per company, since C300.
select company_id,
       count(*) as unlinked_docs,
       min(created_at)::date as earliest,
       'INFO - ' || count(*) || ' invoice/receipt document(s) stored with no linked_invoice_id since 2026-09-01' as verdict
from public.documents
where linked_invoice_id is null
  and document_type in ('invoice','receipt')
  and created_at >= '2026-09-01'
group by company_id
order by unlinked_docs desc;

-- (b) REPAIRABLE FROM THE INTAKE LEDGER — rows whose intake row (C311, 2026-09-10 on)
-- recorded which entry the document became. Anything older than C311 carries an EMPTY
-- journal_entry_ids and is NOT repairable here; guessing by amount/date is exactly the
-- silent mis-link this table must never carry.
select count(*) as repairable,
       case when count(*) = 0
            then 'INFO - nothing repairable from the intake ledger (rows predate C311, or none unlinked)'
            else 'INFO - ' || count(*) || ' document(s) can be linked from document_intake.journal_entry_ids[1]' end as verdict
from public.documents d
join public.document_intake i on i.document_id = d.id and i.company_id = d.company_id
where d.linked_invoice_id is null
  and cardinality(i.journal_entry_ids) >= 1;

-- (c) BACKFILL — apply ONLY after (b) reports a non-zero count you expect. Links each
-- unlinked document to the FIRST entry its intake row recorded (the same rule the client's
-- relink uses: jeIds[0], the entry the document was filed against). Idempotent.
-- begin;
-- update public.documents d
--    set linked_invoice_id = (i.journal_entry_ids[1])::text
--   from public.document_intake i
--  where i.document_id = d.id and i.company_id = d.company_id
--    and d.linked_invoice_id is null
--    and cardinality(i.journal_entry_ids) >= 1;
-- commit;

-- (d) VERIFY after (c): the repairable count from (b) must now read 0.
