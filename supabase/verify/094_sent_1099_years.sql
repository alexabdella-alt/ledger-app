-- 094 VERIFY — run each statement ON ITS OWN; each returns one verdict row.

-- (A) the column exists, is an integer array, and is never null
select case
  when exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'contacts'
                  and column_name = 'sent_1099_years' and data_type = 'ARRAY'
                  and udt_name = '_int4' and is_nullable = 'NO')
  then 'PASS - contacts.sent_1099_years exists (integer[], not null)'
  else 'FAIL - contacts.sent_1099_years is missing or the wrong type'
end as verdict;

-- (B) every 2025 "sent" mark was carried into the list — none lost
select case
  when count(*) filter (where sent_1099_2025 is true and not (2025 = any (sent_1099_years))) = 0
  then 'PASS - every 2025 mark is in the years list (' || count(*) filter (where sent_1099_2025 is true) || ' vendors marked sent for 2025)'
  else 'FAIL - ' || count(*) filter (where sent_1099_2025 is true and not (2025 = any (sent_1099_years))) || ' vendors marked sent for 2025 are missing from the list'
end as verdict
from public.contacts;
