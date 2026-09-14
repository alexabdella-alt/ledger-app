-- =====================================================================
-- 088_company_channels.sql  (O82 — email first; docs/EMAIL_CHANNEL_SPEC_O82.md §5)
--
-- One row per company: the secret inbound address token, who may send into it, and
-- the inbound counters. Decisions 2026-09-14: provider Resend · digest OPT-IN · Phase A
-- (the drain books emailed documents when the company is next opened).
--
-- ── WHY THE TOKEN IS THE ROW'S REASON TO EXIST ─────────────────────────
-- A guessable inbound address (`redriver@in…`) lets a stranger put documents into a
-- company's books. The token is the secret half of the sender wall; §2.2's From: check
-- is the other half. Both must match. A viewer must not be able to READ the token —
-- see the select policy below — because a role that cannot write the books must not
-- be able to hand out the address that feeds them.
--
-- ── COUNTERS ARE COLUMNS, NOT A LOG ──────────────────────────────────────
-- The receiver runs with the service role and has no per-user limiter to lean on
-- (there is no user). A per-company hour/day pair is the smallest thing that bounds
-- what a compromised mailbox can cost; the receiver reads-decides-charges in one
-- update, the O113a shape.
--
-- Idempotent; safe to re-run. Apply after 087.
-- =====================================================================
begin;

create table if not exists public.company_channels (
  company_id         uuid        primary key references public.companies(id) on delete cascade,
  inbound_token      text        not null unique check (inbound_token ~ '^[a-z0-9]{10,32}$'),
  allowed_senders    text[]      not null default '{}',
  from_name          text,
  digest_enabled     boolean     not null default false,   -- opt-in (operator, 2026-09-14)
  inbound_hour_count integer     not null default 0,
  inbound_hour_at    timestamptz not null default now(),
  inbound_day_count  integer     not null default 0,
  inbound_day_at     timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.company_channels enable row level security;

-- ★ THE TOKEN IS READABLE BY OWNER/ADMIN ONLY. Postgres RLS is row-level, so the column
-- is hidden by a VIEW for everyone else: members read the view, admins read the table.
drop policy if exists channels_select_admin on public.company_channels;
create policy channels_select_admin on public.company_channels
  for select using (public.is_company_admin(company_id));

drop policy if exists channels_insert_admin on public.company_channels;
create policy channels_insert_admin on public.company_channels
  for insert with check (public.is_company_admin(company_id));

drop policy if exists channels_update_admin on public.company_channels;
create policy channels_update_admin on public.company_channels
  for update using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

-- No member DELETE: the channel is retired by rotating the token, never by removing the
-- row a message history points at.

-- Members see whether a channel exists and the digest setting — never the token.
create or replace view public.company_channel_status
  with (security_invoker = true) as
  select company_id, digest_enabled, from_name, (inbound_token is not null) as configured, updated_at
  from public.company_channels;

commit;

-- VERIFY: supabase/verify/088_company_channels.sql — one statement per check.
