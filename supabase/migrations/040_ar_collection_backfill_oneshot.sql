-- =====================================================================
-- 040_ar_collection_backfill_oneshot.sql   (AR Step 3 — historical backfill)
-- Mirror of 039 for Accounts Receivable. Posts the Dr Cash / Cr A/R entry that was
-- never recorded for invoices marked COLLECTED before the AR collection-posting
-- existed, so GL A/R stops being overstated. Mirrors the AR dry-run predicate exactly.
--
-- Per invoice: Dr Cash / Cr <the A/R account it debited>, for the net A/R amount,
-- dated paid_at → entry_date floored at the cutoff, linked via import_metadata
-- {kind:'ar_collection', payment_for:<invoice id>, backfill:true}.
--
-- IDEMPOTENT + SELF-SCOPING: only touches companies with candidates (skips any
-- invoice that already has a live collection/payment JE via the not-exists check).
-- Safe to re-run. Run once in the Supabase SQL editor.
--
-- NOTE: the dry-run showed ZERO candidates across all companies on current data, so
-- this is a NO-OP today. It exists/tested for a future real-client migration.
-- =====================================================================
begin;

with co as (
  select id, coalesce(cutoff_date, '1900-01-01'::date) as cutoff from public.companies
),
ar_accts as (
  select a.id, a.company_id from public.accounts a join co on co.id = a.company_id
  where a.system_role = 'accounts_receivable' or a.code = '1100'
),
cash as (
  select distinct on (a.company_id) a.company_id, a.id
  from public.accounts a join co on co.id = a.company_id
  where a.system_role = 'cash' or a.code = '1000'
  order by a.company_id, (a.system_role = 'cash') desc, a.code
),
live as (
  select j.* from public.journal_entries j join co on co.id = j.company_id
  where j.status = 'posted' and j.deleted_at is null
),
-- one row per candidate invoice (its net A/R debit, the A/R account, the date)
cands as (
  select j.company_id, j.id as inv_id, min(j.description) as description,
         greatest(coalesce(j.paid_at::date, j.entry_date), co.cutoff) as pay_date,
         (array_agg(l.account_id order by l.account_id))[1] as ar_acct,
         sum(l.debit - l.credit) as amt
  from live j
  join co on co.id = j.company_id
  join public.journal_entry_lines l on l.journal_entry_id = j.id and l.account_id in (select id from ar_accts)
  where j.payment_status = 'collected'
    and coalesce(j.source,'') <> 'opening_balance'
    and coalesce(j.import_metadata->>'kind','') not in ('ap_payment','ar_collection','reversal')
    and j.entry_date >= co.cutoff
    and not exists (select 1 from live p where p.import_metadata->>'payment_for' = j.id::text)
  group by j.company_id, j.id, co.cutoff, j.paid_at, j.entry_date
  having sum(l.debit - l.credit) > 0
),
ins_je as (
  insert into public.journal_entries
    (company_id, entry_date, description, source, status, posted_at, import_metadata)
  select c.company_id, c.pay_date,
         'A/R collection (backfill) — ' || coalesce(c.description, 'invoice'),
         'manual', 'posted', now(),
         jsonb_build_object('kind','ar_collection','payment_for', c.inv_id::text, 'backfill', true)
  from cands c
  returning id, company_id, (import_metadata->>'payment_for') as inv_id
)
insert into public.journal_entry_lines (journal_entry_id, company_id, account_id, debit, credit, memo)
select ins.id, c.company_id, (select id from cash k where k.company_id = c.company_id), c.amt, 0, 'A/R collection backfill (Dr Cash)'
from ins_je ins
join cands c on c.inv_id::text = ins.inv_id and c.company_id = ins.company_id
union all
select ins.id, c.company_id, c.ar_acct, 0, c.amt, 'A/R collection backfill (Cr A/R)'
from ins_je ins
join cands c on c.inv_id::text = ins.inv_id and c.company_id = ins.company_id;

commit;

-- Verify (run after): GL A/R per company.
-- with ar as (select a.id, a.company_id from public.accounts a
--   where a.system_role = 'accounts_receivable' or a.code = '1100')
-- select j.company_id, round(sum(l.debit - l.credit), 2) as gl_ar
-- from public.journal_entry_lines l
-- join public.journal_entries j on j.id = l.journal_entry_id and j.status='posted' and j.deleted_at is null
-- where l.account_id in (select id from ar) group by j.company_id;
