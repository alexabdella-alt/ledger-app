-- C601 — READ-ONLY. Finds sent invoices whose line items were stored twice before the fix
-- (Save Draft, then Send). Changes nothing. One statement, one verdict row.
--
-- A doubled invoice has every (description, quantity, unit_rate) appearing an even number of
-- times, at least twice. The verdict names how many invoices look doubled and lists their
-- numbers; repairing them is a separate, deliberate step.
with per_line as (
  select l.ar_invoice_id, l.description, l.quantity, l.unit_rate, count(*) as n
  from public.ar_invoice_lines l
  group by l.ar_invoice_id, l.description, l.quantity, l.unit_rate
),
per_invoice as (
  select ar_invoice_id
  from per_line
  group by ar_invoice_id
  having bool_and(n >= 2 and n % 2 = 0)
)
select case
  when count(*) = 0 then 'PASS - no invoice has every line stored twice'
  else 'FOUND - ' || count(*) || ' invoice(s) look doubled: ' ||
       string_agg(coalesce(i.invoice_number, i.id::text), ', ' order by i.invoice_number)
end as verdict
from per_invoice p
join public.ar_invoices i on i.id = p.ar_invoice_id;
