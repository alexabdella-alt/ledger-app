-- =====================================================================
-- 089_inbound_messages.sql  (O82 — email first; docs/EMAIL_CHANNEL_SPEC_O82.md §5)
--
-- One row per message the inbound address received. The row is the join between the
-- provider's message id (idempotency — the provider WILL redeliver), the raw message
-- stored as a document (the audit record), and the intake rows its attachments became.
--
-- ── STATUS IS THE SENDER WALL'S OUTCOME, AND EVERY OUTCOME IS A ROW ───────
-- `unknown_sender` and `rate_limited` are stored, never dropped: a message the wall
-- refused is exactly the one a person needs to be able to SEE (and allow, in one click).
-- A wall that discards what it refuses is indistinguishable from a wall with nothing
-- to refuse (C195(7)).
--
-- ── `attachment_count` IS THE PROVIDER'S NUMBER, NOT OURS ─────────────────
-- It is the external control total O60 asks for: the mail server counted the
-- attachments; we count the intake rows we made. A month where the two disagree is
-- the first thing this feature can prove about itself (spec §2.5).
--
-- Idempotent; safe to re-run. Apply after 088.
-- =====================================================================
begin;

create table if not exists public.inbound_messages (
  id                    uuid        default extensions.uuid_generate_v4() primary key,
  company_id            uuid        not null references public.companies(id) on delete cascade,
  provider              text        not null default 'resend',
  provider_message_id   text        not null,
  from_email            text        not null,
  to_email              text        not null,
  subject               text,
  received_at           timestamptz not null default now(),
  raw_document_id       uuid        references public.documents(id),
  attachment_count      integer     not null default 0,
  intake_ids            uuid[]      not null default '{}',
  status                text        not null,
  reply_to_outbound_id  uuid,                                  -- FK added in 090
  reply_text            text,
  detail                text,
  created_at            timestamptz not null default now(),
  constraint inbound_messages_status_check
    check (status in ('accepted','unknown_sender','rate_limited','no_attachments','reply','unreadable')),
  constraint inbound_messages_provider_uniq unique (provider, provider_message_id)
);

create index if not exists inbound_messages_company_received_idx on public.inbound_messages (company_id, received_at desc);
create index if not exists inbound_messages_company_status_idx   on public.inbound_messages (company_id, status);

alter table public.inbound_messages enable row level security;

drop policy if exists inbound_select on public.inbound_messages;
create policy inbound_select on public.inbound_messages
  for select using (public.is_company_member(company_id));

-- ★ MEMBERS MAY RELEASE A HELD MESSAGE (unknown_sender → accepted, after allowing the
-- sender) and nothing else. INSERT is the receiver's alone (service role bypasses RLS);
-- a member who could insert here could fabricate "the mail server counted 3".
drop policy if exists inbound_update_member on public.inbound_messages;
create policy inbound_update_member on public.inbound_messages
  for update using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

commit;

-- VERIFY: supabase/verify/089_inbound_messages.sql
