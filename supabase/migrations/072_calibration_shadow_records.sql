-- =====================================================================
-- 072_calibration_shadow_records.sql  (O88 calibration — C201, shadow mode)
--
-- Durable home for shadow-mode output. The ladder computes a verdict for every
-- bank-sourced line ALONGSIDE the current confidence path, records it here, and
-- BOOKS NOTHING (`docs/CALIBRATION_SPEC_O88_AMENDMENT_A.md` §0, signed).
--
-- ── WHY A TABLE AND NOT AN IN-MEMORY EXPORT ─────────────────────────────
-- The criterion is checked AGAINST ATTESTED MONTHS, by a human, possibly weeks later,
-- and §4.1(3) requires comparing one run to another. An export dies with the run;
-- rows can be queried, diffed and disputed. `run_id` is what makes the run-to-run
-- variance check a query rather than a memory.
--
-- ── FOUR SHAPE DECISIONS, EACH LOAD-BEARING ─────────────────────────────
-- 1. `proposed_account_id` NULL MEANS PARKED. Not a sentinel string — so the foreign
--    key stays real and "the ladder declined to name an account" can never be confused
--    with "the ladder named an account that does not exist".
-- 2. `run_id` groups a pass, so §4.1(3) run-to-run drift is `group by`, not recall.
-- 3. `excluded_reason` IS A COLUMN. Amendment A §2 exclusions are REPORTED, never
--    dropped — and a row that is not there cannot be counted. A shrinking denominator
--    nobody mentions is how a weak result becomes a strong-looking one.
-- 4. NO JSONB BLOB. Every field the criterion scores on is a real column. `O95` is the
--    standing proof of what happens otherwise: `post_journal_entry` cherry-picks named
--    keys out of `p_meta` and silently discards the rest, which is how the payroll gate
--    shipped inert for a whole release. A scoring surface is the last place to put
--    fields somewhere they can vanish without erroring.
--
-- ── TWO DESCRIPTOR COLUMNS, AND WHY (operator addition, 2026-08-25) ─────
-- `descriptor_display` is the full `journal_entries.description` a human sees.
-- `resolver_input` is the string ACTUALLY FED to identity resolution — the RAW half
-- for `bank_import`, the vendor field for READ sources. They differ, and the whole
-- point of the per-source strategy is that they must. Storing only one makes a
-- disagreement untraceable: you cannot tell whether the resolver was wrong or whether
-- it was handed the wrong string. Storing both makes that a two-column comparison.
--
-- NOTHING READS OR WRITES THIS YET at apply time; the executor is `src/lib/shadowRun.js`
-- plus a thin I/O shell, and shadow mode is off until it is wired.
--
-- Apply after `064` and `066`. Idempotent; safe to re-run.
-- =====================================================================
begin;

create table if not exists public.calibration_shadow_records (
  id                     uuid        default extensions.uuid_generate_v4() primary key,
  company_id             uuid        not null references public.companies(id) on delete cascade,
  run_id                 uuid        not null,
  journal_entry_line_id  uuid        not null,
  period                 text        not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),

  descriptor_display     text,
  resolver_input         text,

  entity_key             text,
  identity_source        text        check (identity_source is null or identity_source in ('resolve','read')),
  matched_via            text        check (matched_via is null or matched_via in ('alias','normalized','directory','unresolved')),
  tier                   text        check (tier is null or tier in ('KNOWN','DECLARED','UNIVERSAL','STRANGER')),

  proposed_account_id    uuid        references public.accounts(id),   -- NULL = PARKED
  attested_account_id    uuid        references public.accounts(id),
  verdict                text        check (verdict is null or verdict in ('agree','park','disagree','phantom')),

  excluded_reason        text,
  created_at             timestamptz not null default now(),

  -- A row is either SCORED (it has a verdict) or EXCLUDED (it has a reason). Never
  -- both, never neither — that is the invariant that keeps the denominator honest,
  -- and the schema enforces it rather than trusting the writer.
  constraint shadow_scored_xor_excluded
    check ((verdict is null) <> (excluded_reason is null))
);

create index if not exists shadow_records_run_idx     on public.calibration_shadow_records (company_id, run_id);
create index if not exists shadow_records_line_idx    on public.calibration_shadow_records (journal_entry_line_id);
create unique index if not exists shadow_records_uniq on public.calibration_shadow_records (run_id, journal_entry_line_id);

alter table public.calibration_shadow_records enable row level security;

drop policy if exists shadow_select on public.calibration_shadow_records;
create policy shadow_select on public.calibration_shadow_records
  for select using (public.is_company_member(company_id));

drop policy if exists shadow_insert on public.calibration_shadow_records;
create policy shadow_insert on public.calibration_shadow_records
  for insert with check (public.is_company_member(company_id));

drop policy if exists shadow_delete on public.calibration_shadow_records;
create policy shadow_delete on public.calibration_shadow_records
  for delete using (public.is_company_member(company_id));

-- NO UPDATE POLICY, deliberately. A shadow record is an OBSERVATION of what the ladder
-- proposed at a moment in time. Editing one would make the run-to-run variance check
-- (§4.1.3) meaningless — drift would be indistinguishable from a correction. Re-run
-- with a new `run_id` instead; a superseded run can be deleted whole.

commit;

-- =====================================================================
-- VERIFY (read-only; paste the output into the report, per §6):
--
--   -- (a) the table exists with the columns the criterion scores on
--   select column_name, data_type, is_nullable from information_schema.columns
--   where table_schema='public' and table_name='calibration_shadow_records'
--   order by ordinal_position;
--   -- expect: 16 columns; proposed_account_id and attested_account_id both NULLABLE
--   -- uuid (NULL on proposed = parked); descriptor_display and resolver_input both present
--
--   -- (b) RLS on, and NO update policy
--   select relrowsecurity from pg_class where relname='calibration_shadow_records';
--   -- expect: true
--   select policyname, cmd from pg_policies
--   where schemaname='public' and tablename='calibration_shadow_records' order by cmd;
--   -- expect: 3 rows — select, insert, delete. NO update.
--
--   -- (c) THE XOR INVARIANT ACTUALLY REFUSES. Run inside a transaction, roll back —
--   --     a constraint nobody has watched reject anything is a constraint on paper.
--   begin;
--     insert into public.calibration_shadow_records
--       (company_id, run_id, journal_entry_line_id, period, verdict, excluded_reason)
--     values ((select id from public.companies limit 1), gen_random_uuid(),
--             gen_random_uuid(), '2026-07', 'agree', 'entry_deleted');
--   rollback;
--   -- expect: ERROR — violates check constraint "shadow_scored_xor_excluded"
--   --         (a row may not be both scored AND excluded)
--
--   begin;
--     insert into public.calibration_shadow_records
--       (company_id, run_id, journal_entry_line_id, period)
--     values ((select id from public.companies limit 1), gen_random_uuid(),
--             gen_random_uuid(), '2026-07');
--   rollback;
--   -- expect: the SAME ERROR (a row may not be neither)
--
--   -- (d) empty on arrival — 072 creates, the executor fills
--   select count(*) from public.calibration_shadow_records;
--   -- expect: 0
-- =====================================================================
