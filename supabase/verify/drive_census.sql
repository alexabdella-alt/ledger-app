-- ── WHAT ACTUALLY LANDED IN THE MOST RECENTLY CREATED COMPANY ────────────────
-- Read-only. One statement, one small table. Keyed on the newest company so it needs
-- no uuid typed in. Every row is a COUNT of something real, never an inference.
with co as (
  select id, name from public.companies order by created_at desc limit 1
)
select 'company'                as measure, (select name from co)                      as value,  '' as note
union all
select 'documents stored',        count(*)::text,
       'the file itself — 35 were dropped'                     from public.documents        d, co where d.company_id = co.id
union all
select 'documents by type',       coalesce(string_agg(t || ' ' || n, ', ' order by n desc), '(none)'),
       'placeholder ''other'' means the type was never stamped'
  from (select d.document_type t, count(*) n from public.documents d, co
        where d.company_id = co.id group by 1) x
union all
select 'journal entries booked',  count(*)::text,
       'live only — voided and deleted excluded'
  from public.journal_entries j, co
  where j.company_id = co.id and j.deleted_at is null and j.status <> 'voided'
union all
select 'intake rows by status',   coalesce(string_agg(s || ' ' || n, ', ' order by n desc), '(none)'),
       'failed = will retry · held_for_review = terminal, needs a person'
  from (select i.status s, count(*) n from public.document_intake i, co
        where i.company_id = co.id group by 1) y
union all
select 'intake rows RESUMABLE',   count(*)::text,
       'has stored bytes, so the drain can pick it up'
  from public.document_intake i, co
  where i.company_id = co.id and i.document_id is not null and i.status = 'failed'
union all
select 'intake rows UNRESUMABLE', count(*)::text,
       'NO stored bytes — these need uploading again (this is O133)'
  from public.document_intake i, co
  where i.company_id = co.id and i.document_id is null and i.status in ('failed','received','processing')
union all
select 'AI budget used this hour', coalesce(max(r.count)::text, '(none)'),
       'against a ceiling of 60'
  from public.rate_limit r
  where r.bucket = 'ai' and r.hour_bucket > now() - interval '24 hours';
