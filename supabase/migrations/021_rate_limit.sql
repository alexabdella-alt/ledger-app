-- =====================================================================
-- 021_rate_limit.sql
-- Per-user hourly rate-limit counters, written only by the ai-proxy edge
-- function (service role). RLS is enabled with NO policies so clients can
-- neither read nor reset their own counters — only the service role (which
-- bypasses RLS) touches this table.
--   buckets: 'ai'     → 60 requests / user / hour (every proxy call)
--            'upload' → 20 files    / user / hour (calls tagged x-rate-kind: upload)
-- =====================================================================

begin;

create table if not exists public.rate_limit (
  user_id     uuid        not null,
  bucket      text        not null,            -- 'ai' | 'upload'
  hour_bucket timestamptz not null,            -- date_trunc('hour', now())
  count       integer     not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, bucket, hour_bucket)
);

-- RLS on, no policies = only the service role (RLS-exempt) can read/write.
alter table public.rate_limit enable row level security;

create index if not exists rate_limit_hour_idx on public.rate_limit (hour_bucket);

-- Atomically increment the current hour's counter and return the new value.
-- Increment-then-check: request #60 sets count=60 (allowed); #61 sets count=61 (rejected).
create or replace function public.bump_rate_limit(p_user uuid, p_bucket text)
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_count integer;
begin
  insert into public.rate_limit (user_id, bucket, hour_bucket, count)
  values (p_user, p_bucket, date_trunc('hour', now()), 1)
  on conflict (user_id, bucket, hour_bucket)
  do update set count = public.rate_limit.count + 1, updated_at = now()
  returning count into v_count;
  return v_count;
end;
$$;

revoke all on function public.bump_rate_limit(uuid, text) from public;
grant execute on function public.bump_rate_limit(uuid, text) to service_role;

commit;

-- Optional housekeeping (run on a schedule if the table grows):
--   delete from public.rate_limit where hour_bucket < now() - interval '2 days';
