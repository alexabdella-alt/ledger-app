-- =====================================================================
-- 090_outbound_messages.sql  (O82 — email first; docs/EMAIL_CHANNEL_SPEC_O82.md §5)
--
-- One row per message the app sends, written BEFORE the provider is called. A message
-- we cannot prove was sent is reported as not sent (C194's rule, applied to mail):
-- `status` moves queued → sent → delivered | bounced only through the provider's
-- webhook, which runs as the service role. There is NO member UPDATE policy, so a row
-- cannot be marked delivered by hand.
--
-- ── EXACTLY ONE SUBJECT PER MESSAGE ──────────────────────────────────────
-- A `question` is about a HELD intake row or an anomaly; an `invoice` is about a posted
-- A/R invoice; a `receipt` is about an inbound message. The CHECK below makes "which
-- thing is this about" a property of the row, so a reply can land on exactly one
-- subject and never on a guess.
--
-- Idempotent; safe to re-run. Apply after 089.
-- =====================================================================
begin;

create table if not exists public.outbound_messages (
  id                     uuid        default extensions.uuid_generate_v4() primary key,
  company_id             uuid        not null references public.companies(id) on delete cascade,
  kind                   text        not null check (kind in ('receipt','question','invoice','report','digest')),
  to_email               text        not null,
  subject                text        not null,
  body_text              text        not null,
  reply_token            text        not null unique check (reply_token ~ '^[a-z0-9]{16,40}$'),
  related_intake_id      uuid,
  related_anomaly_id     uuid,
  related_ar_invoice_id  uuid        references public.ar_invoices(id),
  related_inbound_id     uuid        references public.inbound_messages(id),
  status                 text        not null default 'queued'
                                     check (status in ('queued','sent','delivered','bounced','failed')),
  provider               text        not null default 'resend',
  provider_message_id    text,
  error                  text,
  created_by             uuid,
  created_at             timestamptz not null default now(),
  sent_at                timestamptz,
  answered_at            timestamptz,
  -- ★ at most ONE subject. `report` and `digest` have none; every other kind has one.
  constraint outbound_one_subject check (
    (case when related_intake_id     is not null then 1 else 0 end +
     case when related_anomaly_id    is not null then 1 else 0 end +
     case when related_ar_invoice_id is not null then 1 else 0 end +
     case when related_inbound_id    is not null then 1 else 0 end) <= 1
  ),
  constraint outbound_kind_has_subject check (
    kind in ('report','digest')
    or related_intake_id is not null or related_anomaly_id is not null
    or related_ar_invoice_id is not null or related_inbound_id is not null
  )
);

create index if not exists outbound_messages_company_idx on public.outbound_messages (company_id, created_at desc);
create index if not exists outbound_messages_status_idx  on public.outbound_messages (company_id, status);

alter table public.outbound_messages enable row level security;

drop policy if exists outbound_select on public.outbound_messages;
create policy outbound_select on public.outbound_messages
  for select using (public.is_company_member(company_id));

-- NO member INSERT: sends go through the `send-mail` edge function (service role), which
-- is the only path that can also call the provider — a row a member inserted directly
-- would be a message that was never sent, reading as queued forever.
-- NO member UPDATE: status is the provider's to move.

-- Now that both tables exist, the reply link on inbound can be a real FK.
alter table public.inbound_messages
  drop constraint if exists inbound_messages_reply_fk;
alter table public.inbound_messages
  add constraint inbound_messages_reply_fk
  foreign key (reply_to_outbound_id) references public.outbound_messages(id);

commit;

-- VERIFY: supabase/verify/090_outbound_messages.sql
