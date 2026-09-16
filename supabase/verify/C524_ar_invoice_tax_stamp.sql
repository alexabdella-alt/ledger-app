-- C524 — TAXED INVOICES SENT FROM THE APP BEFORE 2026-09-15 CARRY NO `tax_amount` IN `import_metadata`.
-- `persistMultiLineEntry` handed the builder's meta to `post_journal_entry`, which keeps six
-- scalars and drops the rest (O95), and stamped nothing after. `taxChargedOnInvoices` reads
-- `import_metadata->>'tax_amount'` on revenue-bearing entries, so on any month holding one of
-- these the `sales_tax_tie` control total reads $0 charged against a real Sales Tax Payable
-- balance and fails HIGH — blocking sign-off on correct books.
--
-- Run (1) first. It is a census, one row per company. Nothing is written.
-- The repair (2) is commented out and is the OPERATOR'S to run: it stamps tax_amount from the
-- entry's OWN Sales Tax Payable credit line — a fact the ledger holds, not a guess — and only
-- where no tax_amount is already recorded. Re-runnable.

-- (1) CENSUS — one statement, one verdict row per company.
select
  je.company_id,
  count(*) as taxed_ar_invoices_without_stamp,
  sum(l.credit) as tax_unrecorded,
  case when count(*) = 0 then 'PASS - no taxed invoice is missing its tax stamp'
       else 'FAIL - ' || count(*) || ' taxed invoice(s) carry no tax_amount; sales_tax_tie reads $0 charged against ' || sum(l.credit) || ' owed' end as verdict
from public.journal_entries je
join public.journal_entry_lines l on l.journal_entry_id = je.id
join public.accounts a on a.id = l.account_id
where je.source = 'ar_invoice'
  and je.deleted_at is null
  and coalesce(je.status, 'posted') <> 'voided'
  and a.system_role = 'sales_tax_payable'
  and l.credit > 0
  and (je.import_metadata is null or je.import_metadata->>'tax_amount' is null)
group by je.company_id;

-- (2) REPAIR — operator's call. Stamps each entry's tax from its own Sales Tax Payable credit.
-- begin;
-- update public.journal_entries je
--    set import_metadata = coalesce(je.import_metadata, '{}'::jsonb) || jsonb_build_object('tax_amount', t.tax, 'kind', 'ar_invoice')
--   from (
--     select l.journal_entry_id, sum(l.credit) as tax
--       from public.journal_entry_lines l
--       join public.accounts a on a.id = l.account_id
--      where a.system_role = 'sales_tax_payable' and l.credit > 0
--      group by l.journal_entry_id
--   ) t
--  where t.journal_entry_id = je.id
--    and je.source = 'ar_invoice'
--    and je.deleted_at is null
--    and (je.import_metadata is null or je.import_metadata->>'tax_amount' is null);
-- commit;
-- Then re-run (1): it must say PASS.
