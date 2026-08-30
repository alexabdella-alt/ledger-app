-- 083 — GIVE EVERY EXISTING COMPANY AN OPENING BALANCE EQUITY ACCOUNT.
--
-- ── WHY, FROM A LIVE AUDIT RATHER THAN A HUNCH ────────────────────────────────
-- The `O35` role audit (2026-08-30) found `opening_balance_equity` missing on **seven of
-- eleven companies**. It is absent from the seed function, so it reaches a chart only when
-- somebody posts an opening balance — created on the fly by `resolveAccountId`
-- (`App.jsx:1667`), whose own comment names it as the `O108` finding-4 materialisation path.
--
-- ★★ IT WORKS, AND IT WORKS BY ACCIDENT. Every company that ever enters opening balances
-- needs this account, and today it appears underneath them WHILE they are using the product,
-- through the create-mid-flight door that `C223`/`C254` exist to keep shut. The account is
-- not the problem; the moment of its creation is.
--
-- ── WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT ─────────────────────────
-- Adds `3400 Opening Balance Equity` to every company that lacks it. **Additive only** — no
-- rename, no renumber, no deactivation, nothing touched on a company that already has it,
-- and no journal line moved. A chart is the client's record; this adds a line to it and
-- changes nothing that is already there.
--
-- ▶ IT DOES NOT TOUCH `seed_company_accounts`. A NEW company still gets `3400` only through
-- the business-type template (`C254`), which runs when the business profile is saved — so a
-- company that never completes that step still relies on the on-demand path. Closing THAT
-- means editing the seed function, and §6 is explicit: a `create or replace` of a live
-- function must start from `pg_get_functiondef`, never from the repo, because the repo holds
-- five definitions and the newest was never applied. **That is its own task with its own
-- verification, and doing it as a rider on a backfill is how `063` nearly dropped 17
-- accounts.** Recorded as still open rather than quietly bundled.
--
-- Idempotent: re-running adds nothing.

begin;

-- ★★ `origin = 'seed'` IS NOT DECORATION. `070` made the column default to `'runtime'`
-- DELIBERATELY, so that an insert which does not say where it came from is, by definition,
-- one of the materialise-mid-flight doors and shows up in the `O108` detector. This backfill
-- is a deliberate setup operation — the opposite of that — and must say so, or it would
-- arrive in the audit as seven accounts the system appears to have invented on its own.
insert into public.accounts (company_id, code, name, category, system_role, active, is_system, origin)
select c.id, '3400', 'Opening Balance Equity', 'Equity', 'opening_balance_equity', true, true, 'seed' 
from public.companies c
where not exists (
  -- ★ CHECKED ON THE ROLE **AND** THE CODE. A company may hold the account under a
  -- different number (charts get renumbered — that is why the app resolves by role), and a
  -- company may hold `3400` under a different name. Either means it already has one, and
  -- inserting would create a duplicate the role index would then silently pick between.
  select 1 from public.accounts a
  where a.company_id = c.id
    and (a.system_role = 'opening_balance_equity' or a.code = '3400')
);

commit;


-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFY — one standalone statement per check (§6).
-- ═══════════════════════════════════════════════════════════════════════════════

-- VERIFY (a) — every company now has exactly one, and none has two.
--
-- ★ "AT LEAST ONE" IS NOT THE CHECK. A duplicate is the failure this insert could plausibly
-- cause, and `byRole` would resolve to whichever it read last — silently, and differently
-- per session. So the verdict is on the MAXIMUM as well as the minimum.
--
-- select
--   count(*)                                        as companies,
--   min(n)                                          as fewest,
--   max(n)                                          as most,
--   case when min(n) = 1 and max(n) = 1
--        then 'PASS - every company has exactly one opening-balance equity account'
--        else 'FAIL - see fewest/most' end          as verdict
-- from (
--   select c.id, count(a.id) as n
--   from public.companies c
--   left join public.accounts a
--     on a.company_id = c.id and a.system_role = 'opening_balance_equity'
--   group by c.id
-- ) v;


-- VERIFY (b) — nothing else moved. The insert is additive, so the only accounts that may
-- have changed are the new ones, and no journal line may point at them yet.
--
-- select
--   count(*) filter (where l.id is not null) as lines_on_new_accounts,
--   case when count(*) filter (where l.id is not null) = 0
--        then 'PASS - the new accounts carry no history, as an addition should'
--        else 'FAIL - a journal line already points at one' end as verdict
-- from public.accounts a
-- left join public.journal_entry_lines l on l.account_id = a.id
-- where a.system_role = 'opening_balance_equity' and a.created_at > now() - interval '10 minutes';


-- VERIFY (c) — the new accounts are labelled `seed`, not `runtime`.
--
-- ★ Otherwise they arrive in the O108 detector as seven accounts the system appears to have
-- invented on its own — a deliberate backfill impersonating the exact hazard it prevents.
--
-- select
--   count(*) filter (where origin = 'seed')    as labelled_seed,
--   count(*) filter (where origin <> 'seed')   as mislabelled,
--   case when count(*) filter (where origin <> 'seed') = 0
--        then 'PASS - every opening-balance equity account is labelled seed'
--        else 'FAIL - some are labelled runtime and will read as invented' end as verdict
-- from public.accounts where system_role = 'opening_balance_equity';


-- VERIFY (d) — re-running changes nothing. Run the migration a second time, then this.
--
-- select
--   count(*) as obe_accounts,
--   case when count(*) = (select count(*) from public.companies)
--        then 'PASS - one per company after a second run; the insert is idempotent'
--        else 'FAIL - a re-run added rows' end as verdict
-- from public.accounts where system_role = 'opening_balance_equity';
