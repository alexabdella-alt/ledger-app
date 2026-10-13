-- ═══════════════════════════════════════════════════════════════════════════════
-- 094 — WHICH YEARS A 1099 WAS SENT. (C573)
--
-- `contacts.sent_1099_2025` was read for EVERY tax year. From the 2026 tax year on (forms due
-- Jan 31 2027), a vendor marked "sent" last year read as already sent, and the 1099 they are
-- owed this year was never flagged. This adds the list of years; the old column keeps meaning
-- 2025, and every 2025 mark is copied into the list so nothing already recorded is lost.
--
-- ★ THE APP DOES NOT NEED THIS TO RUN. It reads the list when present and the 2025 flag for
-- 2025 only; before this is applied, "Mark as sent" for 2026 refuses and says so (it checks
-- the saved row for the year) rather than claiming a write that was dropped.
--
-- VERIFY: supabase/verify/094_sent_1099_years.sql — two standalone checks, one verdict each.
-- ═══════════════════════════════════════════════════════════════════════════════
begin;

alter table public.contacts add column if not exists sent_1099_years integer[] not null default '{}';

update public.contacts
   set sent_1099_years = array_append(sent_1099_years, 2025)
 where sent_1099_2025 is true
   and not (2025 = any (sent_1099_years));

commit;
