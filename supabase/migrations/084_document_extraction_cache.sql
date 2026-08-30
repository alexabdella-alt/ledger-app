-- 084 — REUSE WHAT WE ALREADY READ FROM A DOCUMENT (O113 proposal 3, accepted 2026-08-26).
--
-- ── WHY ───────────────────────────────────────────────────────────────────────
-- Re-uploading identical bytes re-runs the whole pipeline: classify, extract, code. C193
-- already computes a SHA-256 of every document to dedupe the library, so the key exists and
-- costs nothing new — and the August drive re-uploaded twice, so this is a path people
-- actually take rather than a hypothetical.
--
-- ★★★ THE DESIGN IS ENTIRELY IN *WHICH* ANSWERS MAY BE STORED.
--   · what KIND of document it is  → a property of the bytes. Stored.
--   · vendor / amount / date / lines → a property of the bytes. Stored.
--   · WHICH ACCOUNT it belongs to   → **a property of the COMPANY'S CHART**, which changes.
--     Accounts get added (two migrations did so today), renamed, and learned mappings move.
--     **Storing it would pin a booking decision to a chart that no longer exists** — the same
--     document re-uploaded after a chart change would book to yesterday's answer, silently,
--     and look identical to a correct one. **NOT STORED, and the column is named for what it
--     holds so the omission reads as deliberate.**
--
-- ★★ `extraction_version` IS WHAT STOPS THE CACHE OUTLIVING THE THING IT CACHED. If the
-- extraction prompt changes, every stored answer came from a model that no longer exists in
-- this system — reusing it would make a prompt fix invisible on exactly the documents most
-- likely to be re-uploaded. Bump the constant in `extractionCache.js` and every row goes
-- stale at once, without a migration and without deleting anything.
--
-- Additive and idempotent. Nothing is backfilled: a document read before today has no stored
-- answer and is simply read again, which is today's behaviour.

begin;

alter table public.documents add column if not exists extraction jsonb;
alter table public.documents add column if not exists extraction_version text;

comment on column public.documents.extraction is
  'What was read FROM THE BYTES — the document kind and the extracted fields. Never the account it was coded to: that depends on the company''s chart, which changes.';

-- The lookup is (company_id, content_hash) — the same pair C193's dedupe already uses, so
-- this index serves both.
create index if not exists documents_company_hash_idx
  on public.documents (company_id, content_hash)
  where content_hash is not null;

commit;


-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFY — one standalone statement per check (§6).
-- ═══════════════════════════════════════════════════════════════════════════════

-- VERIFY (a) — both columns exist, and nothing was invented for existing rows.
--
-- ★ A NON-ZERO `with_extraction` HERE WOULD BE A FAILURE, not a head start: a stored answer
-- nobody produced is an answer nobody can trust.
--
-- select
--   count(*)                                                    as documents,
--   count(*) filter (where extraction is not null)              as with_extraction,
--   (select count(*) from information_schema.columns
--     where table_schema='public' and table_name='documents'
--       and column_name in ('extraction','extraction_version')) as columns_added,
--   case when (select count(*) from information_schema.columns
--                where table_schema='public' and table_name='documents'
--                  and column_name in ('extraction','extraction_version')) = 2
--         and count(*) filter (where extraction is not null) = 0
--        then 'PASS - both columns present, no document was given an answer it did not have'
--        else 'FAIL - see the counts' end                       as verdict
-- from public.documents;


-- VERIFY (b) — the lookup index exists and is scoped to rows that can be looked up.
--
-- select
--   indexdef,
--   case when indexdef like '%content_hash%' and indexdef like '%WHERE%'
--        then 'PASS - partial index on (company_id, content_hash)'
--        else 'FAIL - see indexdef' end as verdict
-- from pg_indexes where tablename = 'documents' and indexname = 'documents_company_hash_idx';
