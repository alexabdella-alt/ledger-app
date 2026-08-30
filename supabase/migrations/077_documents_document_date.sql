-- 077 — THE DOCUMENT'S OWN DATE.
--
-- ▶ HOLD — NOT APPLIED. Written 2026-08-29 alongside C229. Apply and verify in the same
-- task (§6), with the verification output in the report.
--
-- ── WHY ───────────────────────────────────────────────────────────────────────
-- Every card in the document library showed `uploaded_at`, so a FEBRUARY bank statement
-- uploaded in August read "Aug 25" — and "find me the January statement" became "remember
-- which day you uploaded it". C229 fixed most of this WITHOUT a column, by deriving the
-- date from the journal entry a document is linked to: that entry's date IS the document's
-- economic date, and it is already stored.
--
-- ★ WHAT DERIVATION CANNOT COVER, AND WHY THE COLUMN IS STILL WORTH IT: a document with NO
-- linked entry. A bank statement parked for the CPA, a contract, a receipt whose invoice
-- was never booked — all of those fall back to the upload date, and the card says
-- "uploaded" so it is at least honest. This column lets the extractor record the date it
-- ALREADY READ off the document at classification time.
--
-- Nullable on purpose: a document whose date we do not know must say so, not carry a
-- plausible substitute. `documentDate()` already prefers this column when present, so
-- applying the migration changes behaviour only for rows that get a value written.
--
-- Idempotent. Additive — no default, no backfill, nothing existing changes.

begin;

alter table public.documents add column if not exists document_date date;

comment on column public.documents.document_date is
  'The date ON the document (invoice date, statement period end), not when it was uploaded. NULL when unknown — never substituted.';

-- Range queries over a company's library are the point of the column.
create index if not exists documents_company_document_date_idx
  on public.documents (company_id, document_date);

commit;


-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFY — ONE STANDALONE STATEMENT PER CHECK, EACH RETURNING A SINGLE VERDICT ROW.
-- Run them ONE AT A TIME (§6: the editor shows only the last statement's result).
-- ═══════════════════════════════════════════════════════════════════════════════

-- VERIFY (a) — the column exists, is a date, and is NULLABLE.
--
-- select
--   data_type, is_nullable, column_default,
--   case when data_type = 'date' and is_nullable = 'YES' and column_default is null
--        then 'PASS - nullable date, no default'
--        else 'FAIL - ' || data_type || ' / nullable=' || is_nullable
--             || ' / default=' || coalesce(column_default, 'none')
--   end as verdict
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'documents' and column_name = 'document_date';


-- VERIFY (b) — NOTHING EXISTING CHANGED. This migration is additive; every pre-existing
-- row must still be NULL, because there is no backfill and there must not be one: a
-- guessed document date is exactly the substitution the column exists to avoid.
--
-- select
--   count(*) as documents_total,
--   count(document_date) as with_a_date,
--   case when count(document_date) = 0
--        then 'PASS - additive; no row was given a date it did not have'
--        else 'FINDING - ' || count(document_date) || ' row(s) already carry a date. '
--             || 'Expected 0 immediately after applying — if this is a re-run, fine.'
--   end as verdict
-- from public.documents;


-- VERIFY (c) — the index is there for the range query the library runs.
--
-- select
--   indexname,
--   case when indexname is not null then 'PASS - index present' else 'FAIL - missing' end as verdict
-- from pg_indexes
-- where schemaname = 'public' and tablename = 'documents'
--   and indexname = 'documents_company_document_date_idx';
