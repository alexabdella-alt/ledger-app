-- =====================================================================
-- 012_contacts_unique_name.sql
-- Enables a race-proof, server-side upsert for contacts by giving each
-- contact a normalized name_key and a unique index on (company_id, name_key).
-- This closes the read-then-write window where two concurrent invoice uploads
-- could each insert the same vendor.
--
-- name_key matches the app's normalization: lowercase, strip everything that
-- isn't a letter or digit  (e.g. "A.W.S." and "aws" both -> "aws").
--
-- NOTE: this enforces ONE contact per normalized name per company (a vendor
-- and a customer with the exact same name are treated as the same contact —
-- which is already how the app's fuzzy matcher behaves). Fuzzy/substring
-- matching ("Amazon Web Services" <-> "AWS") stays in the app; the DB index
-- only de-duplicates EXACT normalized-name collisions.
-- =====================================================================

-- 1. Normalized key, kept in sync automatically by Postgres.
alter table public.contacts
  add column if not exists name_key text
  generated always as (lower(regexp_replace(coalesce(name, ''), '[^A-Za-z0-9]+', '', 'g'))) stored;

-- 2. Merge any pre-existing duplicates so the unique index can be built.
--    For each (company_id, name_key) we keep the earliest id and repoint every
--    foreign-key reference to contacts (discovered dynamically) at the keeper,
--    then delete the duplicate rows.
do $$
declare fk record;
begin
  for fk in
    select tc.table_schema, tc.table_name, kcu.column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and ccu.table_schema = 'public'
      and ccu.table_name   = 'contacts'
  loop
    execute format($f$
      update %I.%I t
         set %I = k.keep_id
        from (
          select c.id as dup_id,
                 (select min(c2.id) from public.contacts c2
                   where c2.company_id = c.company_id and c2.name_key = c.name_key) as keep_id
          from public.contacts c
          where coalesce(c.name_key, '') <> ''
        ) k
       where t.%I = k.dup_id and k.dup_id <> k.keep_id
    $f$, fk.table_schema, fk.table_name, fk.column_name, fk.column_name);
  end loop;
end $$;

-- 3. Delete the duplicate contact rows (keepers remain).
delete from public.contacts c
using (
  select c1.id as dup_id,
         (select min(c2.id) from public.contacts c2
           where c2.company_id = c1.company_id and c2.name_key = c1.name_key) as keep_id
  from public.contacts c1
  where coalesce(c1.name_key, '') <> ''
) k
where c.id = k.dup_id and k.dup_id <> k.keep_id;

-- 4. Enforce uniqueness going forward (skips blank/unnamed rows).
create unique index if not exists contacts_company_name_key_uq
  on public.contacts (company_id, name_key)
  where name_key <> '';
