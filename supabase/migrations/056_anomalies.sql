-- =====================================================================
-- 056_anomalies.sql
-- O83 — anomalies become PERSISTED records wired into the trust layer.
--
-- Anomaly detection (runAnomalyDetection → insights.js) was derived into React
-- state only: surfaced via the bell + AI snapshot, dismissals in localStorage,
-- nothing persisted, nothing blocking sign-off, resolution left no trace. During
-- O83, 4 HIGH duplicate-payment anomalies fired while the owner panel showed
-- "Nothing wrong", Review showed "All clear", and the sign-off gate would have
-- passed. This table makes anomalies durable, deduped by a stable content
-- `fingerprint`, auto-resolvable (clearing is now an EVENT, not amnesia), and
-- readable by the three trust consumers (ownerTrust / signOffReadiness / Review).
--
-- Lifecycle:
--   • detected, no open row with that fingerprint  → INSERT status='open'
--   • re-detected, open row exists                 → no-op (bump last_seen_at)
--   • open row's condition no longer detected       → AUTO-RESOLVE
--       (status='resolved', resolution='auto', resolved_at=now) — history survives
--   • human judges it acceptable                    → DISMISS
--       (status='dismissed', dismissed_reason REQUIRED, durable across devices)
--   'resolved' (condition gone) and 'dismissed' (human accepted) are DISTINCT and
--   must not blur — a human never sets 'resolved'; the next scan does, honestly.
-- Apply 001 first (for is_company_member).
-- =====================================================================
begin;

create extension if not exists "uuid-ossp";

create table if not exists public.anomalies (
  id              uuid        default uuid_generate_v4() primary key,
  company_id      uuid        not null references public.companies(id) on delete cascade,
  type            text        not null,                          -- duplicate_payment, vendor_spike, …
  severity        text        not null default 'medium'
                    check (severity in ('high','medium','low')),
  status          text        not null default 'open'
                    check (status in ('open','resolved','dismissed')),
  fingerprint     text        not null,                          -- stable content key (re-detection ⇒ same fp)
  title           text,
  detail          text,
  entity_refs     jsonb       not null default '[]'::jsonb,      -- linked journal-entry (flattened) ids
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),            -- bumped when re-detected while open
  resolved_at     timestamptz,                                   -- when it left 'open' (auto-resolve OR dismiss)
  resolved_by     uuid,                                          -- the dismisser; NULL for system auto-resolve
  resolution      text        check (resolution in ('auto','dismissed')),
  dismissed_reason text                                          -- REQUIRED (app-enforced) when status='dismissed'
);

create index if not exists anomalies_company_status_idx on public.anomalies (company_id, status);

-- At most ONE OPEN row per fingerprint per company (clean upsert / dedup). Resolved
-- and dismissed rows accumulate as history, so this is a PARTIAL unique index.
create unique index if not exists anomalies_open_fingerprint_uidx
  on public.anomalies (company_id, fingerprint) where status = 'open';

alter table public.anomalies enable row level security;

-- Standard tenant isolation: the four is_company_member(company_id) policies (§3).
-- (UI enforces reviewer-only dismissal + required reason; the DB boundary is membership.)
drop policy if exists anomalies_select on public.anomalies;
create policy anomalies_select on public.anomalies
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists anomalies_insert on public.anomalies;
create policy anomalies_insert on public.anomalies
  for insert to authenticated with check (public.is_company_member(company_id));

drop policy if exists anomalies_update on public.anomalies;
create policy anomalies_update on public.anomalies
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists anomalies_delete on public.anomalies;
create policy anomalies_delete on public.anomalies
  for delete to authenticated using (public.is_company_member(company_id));

commit;
