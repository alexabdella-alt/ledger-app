-- 069 (c) — DID CREATING A COMPANY STILL SET UP ITS ACCOUNTS AFTER THE PERMISSION TIGHTENING?
--
-- The one check 069 never ran (docs/notes/MIGRATIONS.md, "069 verification — PARTIAL"): a
-- catalog read proved the grant changed; only a company created AFTERWARDS proves onboarding
-- still works. Companies have been created since (a third-party signup among them), so this
-- reads them instead of making a new one. READ-ONLY. Reports counts only — no names, no data.
-- One statement, one verdict. Closes ROADMAP O108 and "Two checks owed" on a PASS.
with recent as (
  select c.id,
         (select count(*) from public.accounts a where a.company_id = c.id) as accts,
         (select count(*) from public.accounts a where a.company_id = c.id and a.system_role is not null) as roled
  from public.companies c
  where c.created_at >= timestamptz '2026-08-25'
)
select case
  when (select count(*) from recent) = 0
    then 'INCONCLUSIVE - no company has been created since 069 was applied; create one, then re-run'
  when exists (select 1 from recent where accts < 59)
    then 'FAIL - ' || (select count(*) from recent where accts < 59) || ' of ' || (select count(*) from recent)
         || ' companies created since 069 have fewer than the 59 seeded accounts (lowest: ' || (select min(accts) from recent) || ')'
  else 'PASS - ' || (select count(*) from recent) || ' companies created since 069, every one seeded ('
       || (select min(accts) from recent) || ' to ' || (select max(accts) from recent) || ' accounts, '
       || (select min(roled) from recent) || '+ with roles)'
end as verdict;
