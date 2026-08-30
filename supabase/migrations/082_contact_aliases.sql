-- 082 — TELLING US THAT TWO NAMES ARE ONE SUPPLIER (O111).
--
-- ── THE CASE ──────────────────────────────────────────────────────────────────
-- Franklin Ave Properties. The bank line reads `ACH DEBIT - FRANKLIN AVE PROPERTIES LP
-- RENT`; the invoice reads `Franklin Ave Properties`. Rail-stripping removes transport
-- noise and legal suffixes, but the bank descriptor also carries a PURPOSE word — `RENT` —
-- which says what the payment was FOR, not who it was TO. The two doors therefore produce
-- different identities and one landlord becomes two vendors.
--
-- ★★ NOT SOLVED BY MORE STRING SURGERY, DELIBERATELY. Stripping trailing words like
-- RENT / FEES / SERVICES would also eat real vendor names — "Lone Star Restaurant SUPPLY",
-- "Bluebonnet Linen SERVICE". A wrong merge is a ONE-WAY DOOR: it launders one vendor's
-- attested mapping onto another's charges, silently. So the merge is asserted by a person.
--
-- ── WHY `contacts` AND NOT A NEW TABLE ────────────────────────────────────────
-- A contact IS the vendor record — it already holds the name, the type, the 1099 fields and
-- the default account. An alias is another name for that same row, not a new entity, and a
-- join table would invite the question "which contact does this alias point at" that the
-- column answers by construction. It also mirrors `companies.aliases` (O75), which solved
-- the same problem for the company's own identity.
--
-- ★ `text[]` with a `{}` default, so every existing row reads as "no aliases" without a
-- backfill and pre-migration code keeps working.
--
-- Idempotent.

begin;

alter table public.contacts add column if not exists aliases text[] not null default '{}';

comment on column public.contacts.aliases is
  'Other names this supplier appears under (bank descriptors, invoice headers). Asserted by a person, never inferred — a wrong merge silently moves one vendor''s history onto another.';

-- Finding a contact BY an alias is the read this exists for, and it runs on every identity
-- resolution once wired. GIN is the right index for array containment.
create index if not exists contacts_aliases_idx on public.contacts using gin (aliases);

commit;


-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFY — one standalone statement per check (§6).
-- ═══════════════════════════════════════════════════════════════════════════════

-- VERIFY (a) — the column exists, is an array, is NOT NULL, and defaults to empty.
--
-- select
--   data_type, is_nullable, column_default,
--   case when data_type = 'ARRAY' and is_nullable = 'NO' and column_default like '%{}%'
--        then 'PASS - text[] not null default {}'
--        else 'FAIL - see the values' end as verdict
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'contacts' and column_name = 'aliases';


-- VERIFY (b) — every existing contact reads as "no aliases", and none was invented.
--
-- ★ ADDITIVE BY DESIGN: a guessed alias is exactly the silent merge this column exists to
-- prevent, so a non-zero count here is a FAILURE, not a head start.
--
-- select
--   count(*) as contacts,
--   count(*) filter (where coalesce(array_length(aliases, 1), 0) > 0) as with_aliases,
--   case when count(*) filter (where coalesce(array_length(aliases, 1), 0) > 0) = 0
--        then 'PASS - no contact was given an alias it did not have'
--        else 'FAIL - aliases appeared from somewhere' end as verdict
-- from public.contacts;


-- VERIFY (c) — the index is present and is the right kind.
--
-- select
--   indexdef,
--   case when indexdef like '%gin%' then 'PASS - GIN index on aliases' else 'FAIL - wrong index type' end as verdict
-- from pg_indexes where tablename = 'contacts' and indexname = 'contacts_aliases_idx';
