-- =====================================================================
-- 073_accounts_origin_relabel.sql  (O110 — correcting 070's heuristic)
--
-- `070` labelled `origin` using a `created_at` window: anything outside five minutes
-- of a company's first account batch was called `runtime`. That window was labelled a
-- heuristic in its own file, and the diagnostic (2026-08-25) showed it mislabelled
-- **35 of 39** runtime rows. This corrects them.
--
-- ── THE DIAGNOSTIC, AND WHAT EACH POPULATION ACTUALLY IS ────────────────
--   7150 × 11 companies, all 2026-08-17  → SEED. This is `063`'s own backfill, which
--     inserted Uncategorized Expense on every existing company months after each
--     company's seed batch. Seed by definition; mislabelled by construction.
--   22 codes × 1 company (c787582f), all 2026-06-07 → SEED. A same-day batch of
--     canonical chart codes. **Mechanism corrected from the first reading:** these are
--     NOT "the chart grew" — all 22 are present in the `000`-era seed function, so the
--     chart already had them. What happened is that THIS COMPANY was behind the seed
--     and `seed_company_accounts` was re-run for it, inserting what it lacked
--     (`on conflict do nothing`). Same conclusion, different cause — and the cause is
--     what tells us re-running the seed is a thing that happens here, which is exactly
--     what the rule below keys on.
--   2101 × 3 companies, all 2026-06-21 → **GENUINELY RUNTIME. LEFT ALONE.** The payroll
--     path needed Payroll Taxes Payable, the company lacked it, and `ensureAccount`
--     created it. Same code, same day, one row per company, idiosyncratic — exactly
--     what the label is supposed to mean.
--   3400 / 6520 / 6530 × Franklin Ave, 2026-07-22 → **RUNTIME. LEFT ALONE — see below.**
--
-- ── THE RULE: SEED OPERATIONS ARE BATCHES, MATERIALISATIONS ARE SINGLETONS ──
-- Rather than name dates or companies (which would be true today and wrong next time),
-- this relabels by SHAPE: a company receiving five or more accounts on one day was
-- seeded, not surprised. One account appearing on its own is the app reaching for
-- something it needed. The threshold separates the real populations by a wide margin —
-- 22 rows on one side, 1 to 3 on the other — and the PREVIEW below shows exactly what
-- it will touch before it touches anything.
--
-- ── WHY 3400 / 6520 / 6530 STAY `runtime`, against the operator's leaning ────
-- The operator's instinct was to call them `seed` since `068` blessed them as canonical
-- chart members. Recommending otherwise, because `origin` and STATUS are different
-- questions and this column answers the first:
--   • They DID come from runtime materialisation — a CPA recode created 6520/6530,
--     `ensureAccountIdForCode` created 3400. That is how they got here, and it stays
--     true no matter what they became afterwards.
--   • Marking them `seed` would ERASE the only durable evidence in the database that
--     the materialisation path ever fired on a real client's chart. O108's whole
--     finding was that it fired three times, invisibly, across attested months.
--   • It costs nothing operationally: the detector is
--     `system_role IS NULL AND origin <> 'external'`, and all three now have roles, so
--     they do not trip it either way.
--   • "Runtime-created AND now canonical" is precisely expressible as
--     `origin = 'runtime' AND system_role IS NOT NULL`. `origin = 'seed'` would simply
--     be false.
-- If the operator still prefers `seed`, it is one statement:
--     update public.accounts set origin='seed'
--      where code in ('3400','6520','6530') and origin='runtime';
-- Deliberately NOT included, so applying this file cannot enact a decision by accident.
--
-- Apply after `070`. Idempotent; safe to re-run.
-- =====================================================================
begin;

-- (1) `063`'s backfill — Uncategorized Expense, inserted on every existing company.
update public.accounts
   set origin = 'seed'
 where code = '7150' and origin = 'runtime';

-- (2) SEED BATCHES — five or more accounts created for one company on one day.
update public.accounts a
   set origin = 'seed'
  from (
    select company_id, created_at::date as day
    from public.accounts
    where origin = 'runtime'
    group by company_id, created_at::date
    having count(*) >= 5
  ) b
 where a.origin = 'runtime'
   and a.company_id = b.company_id
   and a.created_at::date = b.day;

commit;

-- =====================================================================
-- ★ PREVIEW — RUN BEFORE APPLYING. Read-only; shows exactly what moves.
--
--   select a.code, a.name, count(*) as rows, min(a.created_at)::date as day,
--          case when a.code = '7150' then 'rule 1: 063 backfill'
--               else 'rule 2: seed batch' end as moved_by
--   from public.accounts a
--   join (select company_id, created_at::date as day from public.accounts
--         where origin='runtime' group by 1,2 having count(*) >= 5) b
--     on b.company_id = a.company_id and b.day = a.created_at::date
--   where a.origin = 'runtime'
--   group by a.code, a.name, moved_by
--   union all
--   select code, name, count(*), min(created_at)::date, 'rule 1: 063 backfill'
--   from public.accounts where code='7150' and origin='runtime' group by code, name
--   order by moved_by, code;
--   -- expect: 7150 (11 rows) + c787582f's 22 codes. TOTAL 33 rows moved.
--   -- If anything else appears, the >= 5 threshold is catching a population this
--   -- diagnostic did not see, and this file should not be applied as written.
--
-- VERIFY (after applying):
--
--   -- (a) the distribution moved by exactly 33
--   select origin, count(*) from public.accounts group by origin order by origin;
--   -- expect: external 36 · runtime 6 · seed 530   (was 36 / 39 / 497)
--
--   -- (b) what is LEFT as runtime is only genuine materialisation
--   select code, name, count(*) as companies, min(created_at)::date as day
--   from public.accounts where origin='runtime' group by code, name order by code;
--   -- expect exactly: 2101 (3 companies, 2026-06-21) · 3400, 6520, 6530
--   --                 (1 company each, Franklin Ave, 2026-07-22)
--
--   -- (c) the O108 detector is still clean — relabelling must not resurrect it
--   select company_id, code, name from public.accounts
--   where system_role is null and origin <> 'external';
--   -- expect: 0 rows
--
--   -- (d) nothing was moved OUT of external
--   select count(*) from public.accounts where origin='external';
--   -- expect: 36, unchanged
-- =====================================================================
