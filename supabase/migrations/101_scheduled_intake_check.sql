-- 101 — THE DATABASE CHECKS FOR LOST UPLOADS EVERY 15 MINUTES, EVEN WHEN NOBODY HAS THE APP OPEN (C743).
--
-- C742 raises a Sentry alert when an upload fails, and shows the operator a badge — but both run
-- in a browser. Two holes neither can see:
--   (1) an upload whose browser tab closed mid-way: it sits at 'received' / 'processing' and no
--       code ever runs to say so;
--   (2) an alert the browser never delivered (ad blockers routinely block Sentry).
-- So the database itself looks, every 15 minutes, at the intake ledger (047) and sends Sentry the
-- same event the browser sends (message `upload_not_recorded`, same fingerprint per company and
-- kind, tag `alert=upload_not_recorded`) — so the ONE alert rule the operator sets up covers both.
--
-- WHAT COUNTS AS A HOLE (uploads from the last 3 days; older ones are on the Completeness page):
--   upload_stuck       still 'received'/'processing' 60+ minutes after it arrived
--   upload_failed      'failed'
--   upload_stale       held because it was still not processed after the retry window
--   upload_unreadable  held because nothing could be read from it
-- (the last three are exactly `intakeAlertKind` in src/lib/documentIntake.js.)
--
-- ★ EACH UPLOAD IS ALERTED ONCE PER KIND (ops.intake_alerts) — AND ONLY COUNTS AS ALERTED WHEN
-- SENTRY SAID YES. pg_net sends asynchronously, so a send is recorded with its request id; the next
-- run marks it delivered if Sentry answered 2xx, and DELETES it if Sentry refused or never answered
-- within 10 minutes, so it is sent again. A failed alert must never read as a sent one.
--
-- ★ IDS ONLY go to Sentry (company id, intake ids, a count) — no filenames, no amounts, no names.
-- ★ The Sentry key below is the PUBLIC DSN key the browser bundle already ships to every visitor.
-- ★ Nothing here is reachable from the app's API: schema `ops` is not exposed by PostgREST, and
--   anon/authenticated get no usage on it and no execute on the function.
-- ★ Read-only toward business data: it never changes an upload's status.
--
-- Apply in the Supabase SQL editor (or `supabase db query --linked -f` on the operator's go-ahead).
-- Verify with supabase/verify/101_scheduled_intake_check.sql.

begin;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create schema if not exists ops;
revoke all on schema ops from public, anon, authenticated;

create table if not exists ops.intake_alerts (
  intake_id  uuid not null references public.document_intake(id) on delete cascade,
  kind       text not null,
  request_id bigint,
  delivered  boolean not null default false,
  alerted_at timestamptz not null default now(),
  primary key (intake_id, kind)
);
alter table ops.intake_alerts enable row level security;   -- no policies: database-internal only
revoke all on ops.intake_alerts from public, anon, authenticated;

create or replace function ops.check_intake_holes(p_dry_run boolean default false)
returns table (company_id uuid, kind text, uploads int, request_id bigint)
language plpgsql
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  r      record;
  v_req  bigint;
begin
  -- 1. Settle last run's sends: delivered if Sentry said 2xx; forgotten (so re-sent) if it refused
  --    or never answered within 10 minutes.
  if not p_dry_run then
    update ops.intake_alerts a set delivered = true
     where not a.delivered
       and exists (select 1 from net._http_response h
                    where h.id = a.request_id and h.status_code between 200 and 299);
    delete from ops.intake_alerts a
     where not a.delivered
       and a.alerted_at < now() - interval '10 minutes';
  end if;

  -- 2. Find holes not yet alerted, one Sentry event per company and kind.
  for r in
    with candidates as (
      select d.id, d.company_id,
             case
               when d.status in ('received', 'processing')
                    and d.received_at < now() - interval '60 minutes'      then 'upload_stuck'
               when d.status = 'failed'                                    then 'upload_failed'
               when d.status = 'held_for_review'
                    and d.detail like 'Still not processed%'               then 'upload_stale'
               when d.status = 'held_for_review'
                    and d.detail ilike '%couldn''t extract%'               then 'upload_unreadable'
             end as kind
        from public.document_intake d
       where d.received_at > now() - interval '3 days'
    )
    select c.company_id, c.kind, array_agg(c.id order by c.id) as ids
      from candidates c
     where c.kind is not null
       and not exists (select 1 from ops.intake_alerts a where a.intake_id = c.id and a.kind = c.kind)
     group by c.company_id, c.kind
  loop
    v_req := null;
    if not p_dry_run then
      select net.http_post(
        url     := 'https://o4511645176299520.ingest.us.sentry.io/api/4511645185605632/store/',
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'X-Sentry-Auth', 'Sentry sentry_version=7, sentry_client=shadow-db-check/1.0, sentry_key=bb9fc9a44641c996abf704abdbd14bf7'),
        body    := jsonb_build_object(
                     'event_id',    replace(gen_random_uuid()::text, '-', ''),
                     'timestamp',   to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                     'level',       'error',
                     'platform',    'other',
                     'environment', 'production',
                     'message',     'upload_not_recorded',
                     'fingerprint', jsonb_build_array('upload_not_recorded', r.kind, r.company_id::text),
                     'tags',        jsonb_build_object('alert', 'upload_not_recorded', 'kind', r.kind, 'source', 'database_check'),
                     'extra',       jsonb_build_object('company_id', r.company_id,
                                                       'uploads', cardinality(r.ids),
                                                       'intake_ids', to_jsonb(r.ids[1:20])))
      ) into v_req;
      insert into ops.intake_alerts (intake_id, kind, request_id)
      select unnest(r.ids), r.kind, v_req
      on conflict on constraint intake_alerts_pkey do nothing;
    end if;
    company_id := r.company_id; kind := r.kind; uploads := cardinality(r.ids); request_id := v_req;
    return next;
  end loop;
end;
$fn$;

revoke all on function ops.check_intake_holes(boolean) from public, anon, authenticated;

-- Every 15 minutes. cron.schedule with an existing name replaces that job (idempotent).
select cron.schedule('shadow-intake-check', '*/15 * * * *', $job$select ops.check_intake_holes()$job$);

commit;
