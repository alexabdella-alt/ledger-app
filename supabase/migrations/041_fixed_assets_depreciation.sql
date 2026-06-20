-- =====================================================================
-- 041_fixed_assets_depreciation.sql   (Phase A — event #8, Depreciation)
--
-- There is no fixed-asset / depreciation schema today: capitalization only sets a
-- dead `needs_depreciation` flag on the invoice, so capitalized assets never
-- depreciate (books incomplete). This adds the two tables that store per-asset
-- depreciation info and its generated straight-line schedule.
--
-- MODEL (schedule-then-periodic-post, mirrors recurring/prepaid/lease):
--   • fixed_assets        — the asset master: cost, salvage, useful life, in-service
--                           date, the GL accounts, and a link to the capitalization JE.
--   • depreciation_schedule — one row per month: the planned Dr 6900 / Cr 1510 amount
--                           and date, its status (pending|posted), and the posted JE
--                           it became. "Run depreciation for period" posts the pending
--                           rows due through a chosen date and stamps them posted.
--
-- Each posted period entry is Dr Depreciation Expense (6900) / Cr Accumulated
-- Depreciation (1510) via the canonical multi-line write path (post_journal_entry).
--
-- Straight-line only for now (method CHECK is single-valued, extensible later for
-- declining-balance / units-of-production / MACRS — see CLAUDE.md §11 deferred variants).
--
-- RLS: standard is_company_member isolation, all four policies on both tables.
-- Soft delete on fixed_assets (deleted_at/deleted_by), consistent with §7. Apply 001 first.
-- Idempotent (create-if-not-exists, drop-policy-if-exists). Next free number: 042.
-- =====================================================================
begin;

create extension if not exists "uuid-ossp";

-- ── Asset master ──────────────────────────────────────────────────────────────
create table if not exists public.fixed_assets (
  id                      uuid        default uuid_generate_v4() primary key,
  company_id              uuid        not null references public.companies(id) on delete cascade,
  description             text,
  vendor                  text,
  cost                    numeric     not null,                    -- capitalized cost
  salvage_value           numeric     not null default 0,          -- residual; depreciable base = cost - salvage
  useful_life_months      integer     not null,                    -- straight-line term
  in_service_date         date        not null,                    -- schedule start (defaults to purchase date in the app)
  method                  text        not null default 'straight_line'
                                       check (method in ('straight_line')),
  asset_account_code      text,                                    -- the fixed-asset GL the cost sits in (e.g. 1500)
  dep_expense_code        text        not null default '6900',     -- Depreciation Expense
  accum_dep_code          text        not null default '1510',     -- Accumulated Depreciation
  source_journal_entry_id uuid        references public.journal_entries(id) on delete set null,  -- the capitalization JE
  status                  text        not null default 'active'
                                       check (status in ('active','fully_depreciated','disposed')),
  created_by              uuid,
  created_at              timestamptz default now(),
  deleted_at              timestamptz,
  deleted_by              uuid
);
create index if not exists fixed_assets_company_idx
  on public.fixed_assets (company_id, status);

-- ── Generated schedule (one row per month) ────────────────────────────────────
create table if not exists public.depreciation_schedule (
  id               uuid        default uuid_generate_v4() primary key,
  company_id       uuid        not null references public.companies(id) on delete cascade,
  asset_id         uuid        not null references public.fixed_assets(id) on delete cascade,
  period_index     integer     not null,                           -- 1..useful_life_months
  period_date      date        not null,                           -- the month's posting date
  amount           numeric     not null,                           -- that month's depreciation (last month absorbs rounding)
  status           text        not null default 'pending'
                                check (status in ('pending','posted')),
  journal_entry_id uuid        references public.journal_entries(id) on delete set null,  -- set when posted
  posted_at        timestamptz,
  created_at       timestamptz default now(),
  unique (asset_id, period_index)
);
-- "Run depreciation through DATE" → pending rows due on/before the cutoff.
create index if not exists depreciation_schedule_due_idx
  on public.depreciation_schedule (company_id, status, period_date);
create index if not exists depreciation_schedule_asset_idx
  on public.depreciation_schedule (asset_id, period_index);

-- ── RLS: fixed_assets ─────────────────────────────────────────────────────────
alter table public.fixed_assets enable row level security;

drop policy if exists fixed_assets_select on public.fixed_assets;
create policy fixed_assets_select on public.fixed_assets
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists fixed_assets_insert on public.fixed_assets;
create policy fixed_assets_insert on public.fixed_assets
  for insert to authenticated with check (public.is_company_member(company_id));

drop policy if exists fixed_assets_update on public.fixed_assets;
create policy fixed_assets_update on public.fixed_assets
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists fixed_assets_delete on public.fixed_assets;
create policy fixed_assets_delete on public.fixed_assets
  for delete to authenticated using (public.is_company_member(company_id));

-- ── RLS: depreciation_schedule ────────────────────────────────────────────────
alter table public.depreciation_schedule enable row level security;

drop policy if exists depreciation_schedule_select on public.depreciation_schedule;
create policy depreciation_schedule_select on public.depreciation_schedule
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists depreciation_schedule_insert on public.depreciation_schedule;
create policy depreciation_schedule_insert on public.depreciation_schedule
  for insert to authenticated with check (public.is_company_member(company_id));

drop policy if exists depreciation_schedule_update on public.depreciation_schedule;
create policy depreciation_schedule_update on public.depreciation_schedule
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists depreciation_schedule_delete on public.depreciation_schedule;
create policy depreciation_schedule_delete on public.depreciation_schedule
  for delete to authenticated using (public.is_company_member(company_id));

commit;
