-- O136 residue — documents stored UNLINKED between 2026-09-01 and the C324 deploy (2026-09-11).
-- Read-only census first; the backfill is commented and links ONLY where exactly one entry
-- matches on FOUR keys, never on amount-and-date alone.
--
-- The join: document_intake (document_id, filename, received_at) ↔ upload_log (file_name,
-- completed_at, result->>'vendor', result->>'amount') ↔ journal_entries (description begins
-- with the vendor, a line carries the amount, created within 3 minutes of completed_at).
-- `upload_log.document_id` was never written before C345, which is why the filename+time
-- hop is needed for these rows and will not be for any row after it.

-- (a) CENSUS — candidate links, with how many entries each document could match.
with unlinked as (
  select d.id as document_id, d.company_id, d.name, d.created_at
  from public.documents d
  where d.linked_invoice_id is null and d.document_type in ('invoice','receipt')
    and d.created_at >= '2026-09-01' and d.created_at < '2026-09-12'
),
logs as (
  select u.company_id, u.file_name, u.completed_at,
         u.result->>'vendor' as vendor, (u.result->>'amount')::numeric as amount
  from public.upload_log u
  where u.doc_type = 'invoice' and u.status = 'done' and u.result ? 'vendor'
),
cand as (
  select x.document_id, x.name, l.vendor, l.amount, je.id as entry_id, je.entry_date,
         abs(extract(epoch from (je.created_at - l.completed_at))) as secs_apart
  from unlinked x
  join public.document_intake i on i.document_id = x.document_id
  join logs l on l.company_id = x.company_id and l.file_name = i.filename
              and abs(extract(epoch from (l.completed_at - i.received_at))) < 900
  join public.journal_entries je on je.company_id = x.company_id and je.deleted_at is null
              and je.description ilike l.vendor || ' %'
              and abs(extract(epoch from (je.created_at - l.completed_at))) < 180
  join public.journal_entry_lines jl on jl.journal_entry_id = je.id and jl.debit = l.amount
)
select document_id, name, vendor, amount, count(distinct entry_id) as candidate_entries,
       min(entry_id::text) as entry_id, min(secs_apart) as secs_apart,
       case when count(distinct entry_id) = 1 then 'LINKABLE - exactly one entry matches on file, vendor, amount and time'
            when count(distinct entry_id) = 0 then 'NO MATCH - repair from the transaction''s attach button'
            else 'AMBIGUOUS - ' || count(distinct entry_id) || ' entries match; leave for the attach button' end as verdict
from cand
group by document_id, name, vendor, amount
order by verdict, name;

-- (b) BACKFILL — apply only after reading (a). Links a document to its entry ONLY where (a)
-- said LINKABLE (exactly one candidate). Idempotent; a linked row is never re-pointed.
-- begin;
-- with unlinked as (... paste the CTEs from (a) through `cand` ...),
-- one as (select document_id, min(entry_id::text) as entry_id from cand group by document_id having count(distinct entry_id) = 1)
-- update public.documents d set linked_invoice_id = one.entry_id
--   from one where d.id = one.document_id and d.linked_invoice_id is null;
-- commit;

-- (c) VERIFY — (a) re-run must show every former LINKABLE row gone (linked rows leave `unlinked`).
