-- =====================================================================
-- 039_ap_payment_backfill_oneshot.sql   (AP Step 3 — historical backfill)
-- Posts the Dr Accounts Payable / Cr Cash entry that was never recorded for bills
-- marked PAID before Step 1 existed, so GL AP stops being overstated. Mirrors the
-- dry-run preview predicate exactly, so what posts equals the preview to the penny.
--
-- Per bill: Dr <the AP/accrued account the bill credited> / Cr Cash, for the net AP
-- amount, dated paid_at → entry_date floored at the cutoff, linked via
-- import_metadata {kind:'ap_payment', payment_for:<bill id>, backfill:true}.
--
-- IDEMPOTENT + SELF-SCOPING: only touches companies with candidates (skips any bill
-- that already has a live payment JE via the not-exists check). Safe to re-run — a
-- second run posts nothing. Run once in the Supabase SQL editor. On a fresh rebuild
-- there are no candidates, so it is a no-op.
-- =====================================================================
begin;

with co as (
  select id, coalesce(cutoff_date, '1900-01-01'::date) as cutoff from public.companies
),
liab as (
  select a.id, a.company_id from public.accounts a join co on co.id = a.company_id
  where a.system_role in ('accounts_payable','accrued_liabilities') or a.code in ('2000','2100')
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
-- one row per candidate bill (its net AP/accrued credit, the liability account, the date)
cands as (
  select j.company_id, j.id as bill_id, min(j.description) as description,
         greatest(coalesce(j.paid_at::date, j.entry_date), co.cutoff) as pay_date,
         (array_agg(l.account_id order by l.account_id))[1] as liab_acct,
         sum(l.credit - l.debit) as amt
  from live j
  join co on co.id = j.company_id
  join public.journal_entry_lines l on l.journal_entry_id = j.id and l.account_id in (select id from liab)
  where j.payment_status = 'paid'
    and coalesce(j.source,'') <> 'opening_balance'
    and coalesce(j.import_metadata->>'kind','') not in ('ap_payment','reversal')
    and j.entry_date >= co.cutoff
    and not exists (select 1 from live p where p.import_metadata->>'payment_for' = j.id::text)
  group by j.company_id, j.id, co.cutoff, j.paid_at, j.entry_date
  having sum(l.credit - l.debit) > 0
),
ins_je as (
  insert into public.journal_entries
    (company_id, entry_date, description, source, status, posted_at, import_metadata)
  select c.company_id, c.pay_date,
         'AP payment (backfill) — ' || coalesce(c.description, 'bill'),
         'manual', 'posted', now(),
         jsonb_build_object('kind','ap_payment','payment_for', c.bill_id::text, 'backfill', true)
  from cands c
  returning id, company_id, (import_metadata->>'payment_for') as bill_id
)
insert into public.journal_entry_lines (journal_entry_id, company_id, account_id, debit, credit, memo)
select ins.id, c.company_id, c.liab_acct, c.amt, 0, 'AP payment backfill (Dr AP)'
from ins_je ins
join cands c on c.bill_id = ins.bill_id and c.company_id = ins.company_id
union all
select ins.id, c.company_id, (select id from cash k where k.company_id = c.company_id), 0, c.amt, 'AP payment backfill (Cr Cash)'
from ins_je ins
join cands c on c.bill_id = ins.bill_id and c.company_id = ins.company_id;

commit;

-- Verify (run after): GL AP per company — Test 1 should read 9136.40.
-- with ap as (select a.id, a.company_id from public.accounts a
--   where a.system_role in ('accounts_payable','accrued_liabilities') or a.code in ('2000','2100'))
-- select j.company_id, round(sum(l.credit - l.debit), 2) as gl_ap
-- from public.journal_entry_lines l
-- join public.journal_entries j on j.id = l.journal_entry_id and j.status='posted' and j.deleted_at is null
-- where l.account_id in (select id from ap) group by j.company_id;
