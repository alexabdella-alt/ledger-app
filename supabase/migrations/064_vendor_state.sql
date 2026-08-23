-- =====================================================================
-- 064_vendor_state.sql  (O88 calibration — C201, build surface 3)
--
-- The vendor STATE MACHINE's home: KNOWN / DECLARED / UNIVERSAL / STRANGER as a
-- PERSISTED state per company + entity, with graduation, demotion and decay.
--
-- WHY A TABLE AND NOT A RECOMPUTATION. Confidence recomputed a verdict every month
-- from whatever the descriptor looked like that day — which is why Lone Star produced
-- four months and four different verdicts (§11 O87 (iv)). A tier is a fact about what
-- a HUMAN ATTESTED. Facts are stored once and changed only by an explicit transition.
--
-- NOTHING READS THIS YET. C201 is shadow mode: the ladder computes alongside the
-- confidence path and books nothing. The booking switch is C203, gated on the signed
-- pass criterion (`docs/CALIBRATION_SPEC_O88_AMENDMENT_A.md`).
--
-- ── SHAPE NOTES ─────────────────────────────────────────────────────────
-- `entity_key` is the normalised descriptor identity from `src/lib/vendorIdentity.js`
-- (C200) — content-derived, NOT a display name, so renaming a contact never re-keys a
-- vendor. Same lesson as ·3b(f3): key on content, never on a label that moves.
--
-- `attested_account_id` is a uuid FK to `accounts`, never a role and never a code.
-- That is deliberate and it is what made the whole O108 chart scare irrelevant to
-- calibration: a per-company account id cannot be confused by a role mismatch.
--
-- `distinct_months` is text[] of 'YYYY-MM', not a count. Q1 graduation needs two
-- observations in two DISTINCT statement-months and same-month repetition must never
-- accelerate the clock — storing a count would make that rule unenforceable, and a
-- weekly vendor would graduate in eight days.
--
-- `demotion_reason` is CHECK-constrained to the Q3 exhaustive list. Amount behaviour
-- is deliberately ABSENT: out-of-band books and flags, one attestation cures. If a
-- future migration adds an amount-driven reason here, it has contradicted Q3.
--
-- Apply after `063`/`068`. Idempotent; safe to re-run.
-- =====================================================================
begin;

create table if not exists public.vendor_state (
  id                    uuid        default extensions.uuid_generate_v4() primary key,
  company_id            uuid        not null references public.companies(id) on delete cascade,
  entity_key            text        not null,
  tier                  text        not null default 'STRANGER'
                          check (tier in ('KNOWN','DECLARED','UNIVERSAL','STRANGER')),
  attested_account_id   uuid        references public.accounts(id),
  observation_count     integer     not null default 0,
  distinct_months       text[]      not null default '{}',
  first_seen            text,                     -- 'YYYY-MM'
  last_seen             text,                     -- 'YYYY-MM'
  amount_mean           numeric,
  amount_sd             numeric,
  demoted_at            text,                     -- 'YYYY-MM'
  demotion_reason       text        check (demotion_reason is null or demotion_reason in ('mapping_correction','dormancy')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- One state per vendor per company. The upsert target for every transition.
create unique index if not exists vendor_state_company_entity_idx
  on public.vendor_state (company_id, entity_key);

-- ── RLS — same wall as every other tenant table (§3) ───────────────────
alter table public.vendor_state enable row level security;

drop policy if exists vendor_state_select on public.vendor_state;
create policy vendor_state_select on public.vendor_state
  for select using (public.is_company_member(company_id));

drop policy if exists vendor_state_insert on public.vendor_state;
create policy vendor_state_insert on public.vendor_state
  for insert with check (public.is_company_member(company_id));

drop policy if exists vendor_state_update on public.vendor_state;
create policy vendor_state_update on public.vendor_state
  for update using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

-- No DELETE policy. A vendor's history is not something the app deletes; a vendor that
-- goes quiet DECAYS (dormancy → DECLARED) and keeps its observations. Deliberate: the
-- same reasoning as soft-delete on the ledger (§7).

commit;

-- =====================================================================
-- VERIFY (read-only; paste the output into the report, per §6):
--
--   -- (a) the table exists with the columns the state machine writes
--   select column_name, data_type from information_schema.columns
--   where table_schema = 'public' and table_name = 'vendor_state'
--   order by ordinal_position;
--   -- expect: 15 columns; distinct_months is ARRAY; attested_account_id is uuid
--
--   -- (b) RLS is ON and the three policies exist — a tenant table without a wall
--   --     is the O108-class defect in a new place
--   select relrowsecurity from pg_class where relname = 'vendor_state';
--   -- expect: true
--   select policyname, cmd from pg_policies
--   where schemaname = 'public' and tablename = 'vendor_state' order by policyname;
--   -- expect: 3 rows — select, insert, update. NO delete policy.
--
--   -- (c) the CHECK constraints hold the Q1/Q3 rules
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.vendor_state'::regclass and contype = 'c';
--   -- expect: tier in the four tiers; demotion_reason limited to
--   -- mapping_correction/dormancy — amount behaviour must NOT appear
--
--   -- (d) nothing is in it yet — 064 creates, 065 backfills
--   select count(*) from public.vendor_state;
--   -- expect: 0
-- =====================================================================
