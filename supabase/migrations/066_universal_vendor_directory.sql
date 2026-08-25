-- =====================================================================
-- 066_universal_vendor_directory.sql  (O88 calibration — C202, build surface 2)
--
-- The CURATED, GLOBAL, BINARY directory: a vendor is in it with ONE canonical
-- mapping, or it is not in it. Spec line 27 — "no fuzzy-match scores, no '76%
-- consulting-ish'" — so there is no score column here and there must never be one.
--
-- ── THIS TABLE IS GLOBAL, NOT TENANT-SCOPED. READ THE RLS CAREFULLY. ────
-- Every other table in this schema carries `company_id` and is walled by
-- `is_company_member`. This one deliberately has NO `company_id`: it is a house-rules
-- asset owned by the CPA, shared by every tenant. So its policy shape is the
-- inverse of the usual one and needs its own reasoning rather than a copied pattern:
--   • SELECT — any authenticated user. The directory contains no tenant data; it is a
--     list of national vendors and the accounts they belong in. Leaking it leaks
--     nothing about anybody's books.
--   • INSERT / UPDATE / DELETE — `is_platform_admin()` ONLY. Curation is the whole
--     safety argument: a tenant who could add a row could redirect a vendor's default
--     mapping for EVERY OTHER TENANT. That is the one genuinely cross-tenant write in
--     the product, and it is closed to everyone but the operator.
--
-- ── WHAT A HIT MEANS ────────────────────────────────────────────────────
-- Tier UNIVERSAL: the line BOOKS to the curated default AND flags (batched by vendor)
-- until a human attests, at which point the mapping becomes company-attested and the
-- KNOWN clock starts. **Curation is not attestation** — the directory never makes a
-- vendor KNOWN by itself.
--
-- ── `match_type` — WHY THE LOOSER RULE IS OPT-IN PER ROW ────────────────
-- 'exact' (after normalisation) is the default and the spec's literal reading.
-- 'prefix' exists because EXACT cannot recognise Toast, the case that motivated this
-- build: its descriptors carry a MONTH NAME (`…MERCHANT FEES JAN` / `FEB` / `APRIL`),
-- normalising to a different key every month. Prefix is still BINARY — it matches or
-- it does not, unscored — and is token-boundary safe in the matcher.
--
-- It is per-row so a curator must CHOOSE it, and the choice is visible in the data.
-- Two defects in the first draft of the seed, both caught by an anti-merge probe:
-- `square inc` as a PREFIX pattern degraded to `square` (normalising a pattern strips
-- legal suffixes) and swallowed `SQUARE DANCE HALL`; `sysco` as a PREFIX swallowed
-- `SYSCO FUEL`, a pair the identity tests already assert must never merge. Both are
-- Q4's one-way door re-entering through the directory.
--
-- ── SEED SCOPE, and two categories left out on purpose ──────────────────
-- Only national vendors whose mapping is genuinely uncontroversial — every row is a
-- claim that ANY restaurant booking this vendor wants this account, and that has to
-- be true for a stranger's books.
--   • UTILITIES are NOT seeded: there is essentially no national utility, and a local
--     one belongs to the per-company ALIAS mechanism (`O111`), not a global asset.
--   • DELIVERY PLATFORMS are NOT seeded: commission vs marketing vs revenue-contra is
--     a genuinely contested mapping, and a contested default in a global asset is
--     plausibility scoring with a human's name on it.
--
-- The seed below must stay identical to `DIRECTORY_SEED` in `src/lib/vendorDirectory.js`
-- — a test asserts they agree, because a seed that drifts from its migration is the
-- ·3b(f3) two-halves-of-one-contract failure.
--
-- Apply after `064`. Idempotent; safe to re-run.
-- =====================================================================
begin;

create table if not exists public.universal_vendor_directory (
  id                    uuid        default extensions.uuid_generate_v4() primary key,
  entity_key            text        not null unique,
  canonical_name        text        not null,
  match_patterns        text[]      not null default '{}',
  match_type            text        not null default 'exact'
                          check (match_type in ('exact','prefix')),
  default_account_role  text        not null,
  active                boolean     not null default true,
  curated_by            uuid        references auth.users(id),
  curated_at            timestamptz not null default now(),
  notes                 text
);

comment on table public.universal_vendor_directory is
  'Curated GLOBAL vendor directory (O88 C202). Binary matching only — no scores. Not tenant-scoped: readable by any authenticated user, writable by platform admins only.';

alter table public.universal_vendor_directory enable row level security;

drop policy if exists uvd_select on public.universal_vendor_directory;
create policy uvd_select on public.universal_vendor_directory
  for select using (auth.uid() is not null);

drop policy if exists uvd_insert on public.universal_vendor_directory;
create policy uvd_insert on public.universal_vendor_directory
  for insert with check (public.is_platform_admin());

drop policy if exists uvd_update on public.universal_vendor_directory;
create policy uvd_update on public.universal_vendor_directory
  for update using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists uvd_delete on public.universal_vendor_directory;
create policy uvd_delete on public.universal_vendor_directory
  for delete using (public.is_platform_admin());

-- ── THE CURATED SEED ────────────────────────────────────────────────────
-- ON CONFLICT DO NOTHING: re-applying never overwrites a curator's later edit.
insert into public.universal_vendor_directory
  (entity_key, canonical_name, match_patterns, match_type, default_account_role)
values
  ('toast',               'Toast',               array['toast merchant fees','toast inc merchant fees'], 'prefix', 'merchant_processing_fees'),
  ('square',              'Square',              array['squareup','square inc'],                          'exact',  'merchant_processing_fees'),
  ('stripe',              'Stripe',              array['stripe','stripe payments'],                       'exact',  'merchant_processing_fees'),
  ('meta ads',            'Meta Ads',            array['facebook ads','facebk ads','meta platforms'],     'exact',  'marketing_advertising'),
  ('google ads',          'Google Ads',          array['google ads','google adwords'],                    'exact',  'marketing_advertising'),
  ('sysco',               'Sysco',               array['sysco','sysco foods'],                            'exact',  'cogs'),
  ('us foods',            'US Foods',            array['us foods','usfoods'],                             'exact',  'cogs'),
  ('restaurant depot',    'Restaurant Depot',    array['restaurant depot'],                               'exact',  'cogs'),
  ('gordon food service', 'Gordon Food Service', array['gordon food service'],                            'exact',  'cogs'),
  ('amazon web services', 'Amazon Web Services', array['amazon web services','aws'],                      'exact',  'technology_software'),
  ('google workspace',    'Google Workspace',    array['google workspace','google gsuite'],               'exact',  'technology_software')
on conflict (entity_key) do nothing;

commit;

-- =====================================================================
-- VERIFY (read-only; paste the output into the report, per §6):
--
--   -- (a) 11 seeded rows, exactly one PREFIX entry
--   select count(*) as rows,
--          count(*) filter (where match_type = 'prefix') as prefix_rows,
--          count(*) filter (where match_type = 'exact')  as exact_rows
--   from public.universal_vendor_directory;
--   -- expect: rows = 11, prefix_rows = 1 (toast), exact_rows = 10
--
--   -- (b) every default_account_role EXISTS in the live chart — a directory whose
--   --     mapping points at a role no company has would book to a fallback
--   select d.entity_key, d.default_account_role,
--          count(distinct a.company_id) as companies_with_that_role
--   from public.universal_vendor_directory d
--   left join public.accounts a on a.system_role = d.default_account_role
--   group by d.entity_key, d.default_account_role
--   order by companies_with_that_role, d.entity_key;
--   -- expect: every row shows 11 companies. ANY ROW SHOWING 0 IS A BROKEN MAPPING —
--   -- most likely merchant_processing_fees, which only exists if `068` was applied.
--
--   -- (c) RLS: readable by authenticated, writable by platform admin only
--   select relrowsecurity from pg_class where relname = 'universal_vendor_directory';
--   -- expect: true
--   select policyname, cmd, qual, with_check from pg_policies
--   where schemaname='public' and tablename='universal_vendor_directory' order by cmd;
--   -- expect: 4 policies. SELECT qual = (auth.uid() IS NOT NULL);
--   -- INSERT/UPDATE/DELETE all gated on is_platform_admin().
--
--   -- (d) THE CROSS-TENANT WRITE IS ACTUALLY CLOSED. This is the one policy in the
--   --     product whose failure would let one tenant redirect another's mappings, so
--   --     do not take the policy text on trust — try it as a NON-admin and watch it
--   --     refuse. (Needs the non-platform-admin account that ROADMAP TIER 1 #8 owes.)
--   --   insert into public.universal_vendor_directory
--   --     (entity_key, canonical_name, match_patterns, default_account_role)
--   --   values ('__probe__','Probe',array['probe'],'cogs');
--   -- expect (as non-admin): ERROR — new row violates row-level security policy
-- =====================================================================
