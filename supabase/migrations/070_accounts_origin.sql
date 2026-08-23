-- =====================================================================
-- 070_accounts_origin.sql  (O110 remediation (b))
--
-- Restores the meaning of the O108 fingerprint by recording WHERE an account came
-- from, instead of inferring it from `system_role IS NULL`.
--
-- ── WHY THE OLD DETECTOR DIED ───────────────────────────────────────────
-- `system_role IS NULL` meant "invented at runtime", and it was the durable outcome
-- of the O108 diagnosis — one query that finds every account the app created behind
-- your back. Then `068`'s VERIFY returned 36 role-less accounts on three fixture
-- companies, from a FOREIGN chart, created outside the application entirely (audit log:
-- zero rows for the window). The detector now returns 36 rows of noise and 0 rows of
-- signal, which is worse than no detector: it looks like it works.
--
-- ── WHY NOT THE CHEAPER OPTION ──────────────────────────────────────────
-- Role-blessing the 36 was considered and REJECTED. They are a foreign chart, so
-- `5300 Utilities` and `6200 Utilities` would both want `system_role = 'utilities'` on
-- the same company — and `useAccounts.byRole` is a plain object built by iteration, so
-- one would silently SHADOW the other and every `getAccountByRole('utilities')` would
-- resolve to whichever happened to come last. That trades a diagnostic for a
-- silent-wrong-account bug. Quarantine (`active = false`) was also considered and is
-- DEAD: `5300 Utilities` and `6450 Vehicle Expense` each carry a LIVE journal line.
--
-- ── THE TWO LIVE BOOKINGS, STATED PLAINLY ───────────────────────────────
-- Two accounts in a chart nobody in this codebase recognises are carrying real,
-- undeleted journal lines, and because their `system_role` is NULL they are invisible
-- to every `getAccountByRole` lookup in the app. They are on fixture companies, not
-- Franklin Ave. This migration does NOT move those lines — reclassifying a booked
-- transaction is an accounting decision, not a schema one. It only labels the account.
--
-- ── THE NEW DETECTOR ────────────────────────────────────────────────────
--     select * from public.accounts
--     where system_role is null and origin <> 'external';
-- Honest as new doors appear, because a door that does not set `origin` gets the
-- column default 'runtime' and shows up rather than hiding.
--
-- NOTE the default is deliberately 'runtime', NOT 'seed': an INSERT that forgets to
-- say where it came from is, by definition, one of the seven materialisation sites.
-- Defaulting to 'seed' would let the next unaudited door label itself legitimate.
--
-- Apply after `068`. Idempotent; safe to re-run.
-- =====================================================================
begin;

alter table public.accounts
  add column if not exists origin text not null default 'runtime';

alter table public.accounts drop constraint if exists accounts_origin_check;
alter table public.accounts
  add constraint accounts_origin_check
  check (origin in ('seed','runtime','external','import'));

-- ── BACKFILL ────────────────────────────────────────────────────────────
-- (1) EXTERNAL — the 36. Identified by the only property that distinguishes them and
--     is stable: no system_role after `068` blessed every account the app knows about.
--     Verified 2026-08-23 to be exactly 36 rows on three companies.
update public.accounts set origin = 'external' where system_role is null;

-- (2) SEED — everything created in a company's FIRST account batch. The seed inserts
--     all ~59 rows in one statement, so they share a created_at to the microsecond;
--     anything created later was created by something else. This is a heuristic and is
--     labelled as one: see the PREVIEW in VERIFY, and run it BEFORE applying.
update public.accounts a set origin = 'seed'
 where a.system_role is not null
   and a.created_at <= (
     select min(b.created_at) + interval '5 minutes'
     from public.accounts b where b.company_id = a.company_id
   );

-- (3) Everything else keeps the 'runtime' default — accounts the app materialised
--     after the seed batch. On Franklin Ave that is 3400, 6520 and 6530, which is
--     exactly right: they WERE runtime-materialised, and `068` blessing them with
--     roles did not change where they came from.

commit;

-- =====================================================================
-- ★ PREVIEW — RUN THIS BEFORE APPLYING. It is read-only and shows exactly what the
--   backfill will label, so the heuristic in (2) is checked rather than trusted.
--
--   select case
--            when system_role is null then 'external'
--            when created_at <= (select min(b.created_at) + interval '5 minutes'
--                                from public.accounts b where b.company_id = a.company_id)
--              then 'seed'
--            else 'runtime'
--          end as would_label,
--          count(*) as accounts, count(distinct company_id) as companies
--   from public.accounts a group by 1 order by 1;
--   -- expect roughly: external 36 / seed ~600 / runtime a small handful (3400, 6520,
--   -- 6530 and the second company's 3400). If `runtime` is large, the 5-minute window
--   -- is wrong for this data and (2) needs rethinking BEFORE this is applied.
--
--   -- and name the runtime ones, since they should be individually recognisable:
--   select company_id, code, name, created_at from public.accounts a
--   where system_role is not null
--     and created_at > (select min(b.created_at) + interval '5 minutes'
--                       from public.accounts b where b.company_id = a.company_id)
--   order by created_at;
--   -- expect: Franklin's 3400/6520/6530 + one other company's 3400. Anything else is
--   -- an eighth materialisation door nobody has found yet.
--
-- VERIFY (after applying):
--
--   -- (a) every account is labelled, and the labels are the four we allow
--   select origin, count(*) from public.accounts group by origin order by origin;
--   -- expect: external 36; seed the bulk; runtime a handful; import 0
--
--   -- (b) THE DETECTOR IS RESTORED — 0 rows means no unexplained runtime account
--   select company_id, code, name, created_at from public.accounts
--   where system_role is null and origin <> 'external';
--   -- expect: 0 rows
--
--   -- (c) the two live foreign bookings are labelled but UNMOVED
--   select a.code, a.name, a.origin, count(*) filter (where je.deleted_at is null) as live_lines
--   from public.accounts a
--   join public.journal_entry_lines l on l.account_id = a.id
--   join public.journal_entries je on je.id = l.journal_entry_id
--   where a.code in ('5300','6450') group by a.code, a.name, a.origin;
--   -- expect: both origin='external', live_lines = 1 each. UNCHANGED counts.
-- =====================================================================
