-- 086 — THE RATE LIMIT BECOMES A ROLLING HOUR INSTEAD OF A CLOCK HOUR.
--
-- ── THE DEFECT (`O113c`) ──────────────────────────────────────────────────────
-- `021`/`074` key the counter on `date_trunc('hour', now())`, so the budget resets at the
-- top of every hour. Run out at 2:05 and you wait 55 minutes; run out at 2:55 and you wait
-- five. **The same mistake costs eleven times as much depending on nothing but when it
-- happened**, and nothing about that is explicable to the person waiting.
--
-- ★★ THE REASON TO FIX IT IS NOT FAIRNESS — IT IS THE ONBOARDING QUEUE. A new client drops
-- 200 invoices and the drain works through them over hours. Under a clock hour it processes
-- a burst at :00 and then sits COMPLETELY IDLE for 59 minutes. Under a rolling window
-- capacity returns continuously as old calls age out, so the queue visibly drains instead of
-- stalling — same total throughput, a completely different thing to watch.
--
-- ★ AND IT MAKES THE RESET TIME HONEST. Under a clock hour the proxy can only say "top of
-- the hour". Under a rolling window the function knows exactly WHICH call has to age out for
-- the next one to be allowed, so it can return a real number — usually a couple of minutes,
-- not fifty-five.
--
-- ── WHAT IS PRESERVED, DELIBERATELY ───────────────────────────────────────────
--   · **decide, then charge** (`O113a`) — a refusal must never consume budget. `ai = 81`
--     against a ceiling of 60 is that bug visible in production data, and it made retrying
--     actively harmful.
--   · **all-or-nothing across buckets** — an upload-tagged call that passes `ai` and is
--     refused by `upload` must not leave the `ai` charge behind. Same defect, different hat.
--   · **the same return shape**, so a caller that has not been updated keeps working.
--
-- ── DEPLOY ORDER IS NOT LOAD-BEARING THIS TIME ────────────────────────────────
-- `074` had to be applied BEFORE its proxy deploy, because the reverse called a function
-- that did not exist. Here the signature is unchanged: an un-migrated database still answers
-- the new proxy (which falls back to clock-hour maths when `resets_in_minutes` is absent),
-- and a migrated database still answers the old proxy (which ignores the extra field).
-- Either order is safe.
--
-- ▶ `rate_limit` and `bump_rate_limit` are KEPT, not dropped — same reasoning as `074`: the
-- edge function and the database deploy separately, and a rollback must not hit a missing
-- table.

begin;

-- ── One row per charged call, instead of one counter per clock hour ───────────
create table if not exists public.rate_limit_events (
  id       bigserial   primary key,
  user_id  uuid        not null,
  bucket   text        not null,
  at       timestamptz not null default now()
);

-- The only query shape this table has: "how many of MY calls in THIS bucket are still inside
-- the window", and "which is the oldest". Both are served by one index.
create index if not exists rate_limit_events_lookup_idx
  on public.rate_limit_events (user_id, bucket, at desc);

alter table public.rate_limit_events enable row level security;
-- ★ NO POLICIES, ON PURPOSE — the same shape as `rate_limit` (021). RLS on with no policy
-- means no client can read or write it at all; the service role bypasses RLS and is the only
-- caller. A user who could insert here could hand themselves unlimited budget.

create or replace function public.consume_rate_limit(
  p_user uuid,
  p_buckets text[],
  p_limits integer[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window    interval := interval '1 hour';
  v_bucket    text;
  v_idx       integer;
  v_count     integer;
  v_limit     integer;
  v_blocked   text := null;
  v_blimit    integer := null;
  v_bcount    integer := null;
  v_oldest    timestamptz;
  v_resets    integer := null;
  v_counts    jsonb := '{}'::jsonb;
  v_remaining jsonb := '{}'::jsonb;
begin
  if p_user is null or p_buckets is null or p_limits is null
     or array_length(p_buckets, 1) is distinct from array_length(p_limits, 1) then
    raise exception 'consume_rate_limit: buckets and limits must be non-null and the same length';
  end if;

  -- ★★ SERIALISE PER USER. The counter version took `for update` on a row; with events there
  -- is no single row to lock, so one advisory lock per user does the same job — two
  -- concurrent requests cannot both observe 59 and both be allowed. Held to the end of the
  -- transaction, and keyed on the user so different users never contend.
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));

  -- Housekeeping first: anything outside the window is not evidence any more. Bounded — at
  -- most one hour of one user's calls — and it keeps the table from growing without limit.
  delete from public.rate_limit_events
   where user_id = p_user and at <= now() - v_window;

  -- ── PASS 1 — DECIDE. Read every bucket against its limit BEFORE writing anything.
  -- This ordering is the whole of `O113a`: a refusal must not consume budget.
  for v_idx in 1 .. array_length(p_buckets, 1) loop
    v_bucket := p_buckets[v_idx];
    v_limit  := p_limits[v_idx];

    select count(*) into v_count
      from public.rate_limit_events
     where user_id = p_user and bucket = v_bucket and at > now() - v_window;

    v_counts := v_counts || jsonb_build_object(v_bucket, v_count);
    if v_blocked is null and v_count >= v_limit then
      v_blocked := v_bucket; v_blimit := v_limit; v_bcount := v_count;
    end if;
  end loop;

  if v_blocked is not null then
    -- ★ THE REAL RESET TIME. Capacity returns when enough of the oldest calls age out. With
    -- the count at the limit that is the single oldest call in the window — usually minutes
    -- away, where a clock hour could only ever say "up to 59".
    select at into v_oldest
      from public.rate_limit_events
     where user_id = p_user and bucket = v_blocked and at > now() - v_window
     order by at
    offset greatest(0, v_bcount - v_blimit)
     limit 1;

    v_resets := greatest(0, ceil(extract(epoch from ((v_oldest + v_window) - now())) / 60.0))::integer;

    for v_idx in 1 .. array_length(p_buckets, 1) loop
      v_remaining := v_remaining || jsonb_build_object(
        p_buckets[v_idx],
        greatest(0, p_limits[v_idx] - coalesce((v_counts ->> p_buckets[v_idx])::integer, 0)));
    end loop;

    -- NOTHING was charged. Not for the blocked bucket, and not for the ones that passed.
    return jsonb_build_object(
      'allowed', false, 'blocked_bucket', v_blocked,
      'counts', v_counts, 'remaining', v_remaining,
      'resets_in_minutes', v_resets);
  end if;

  -- ── PASS 2 — ALLOWED → charge every bucket, together.
  v_counts := '{}'::jsonb; v_remaining := '{}'::jsonb;
  for v_idx in 1 .. array_length(p_buckets, 1) loop
    v_bucket := p_buckets[v_idx];
    v_limit  := p_limits[v_idx];

    insert into public.rate_limit_events (user_id, bucket) values (p_user, v_bucket);

    select count(*) into v_count
      from public.rate_limit_events
     where user_id = p_user and bucket = v_bucket and at > now() - v_window;

    v_counts    := v_counts    || jsonb_build_object(v_bucket, v_count);
    v_remaining := v_remaining || jsonb_build_object(v_bucket, greatest(0, v_limit - v_count));
  end loop;

  return jsonb_build_object(
    'allowed', true, 'blocked_bucket', null,
    'counts', v_counts, 'remaining', v_remaining,
    'resets_in_minutes', null);
end;
$$;

-- Same ACL as before: service role only. Asserted rather than assumed — O108 finding 2 is
-- the precedent, where a live `anon=X` survived on a SECURITY DEFINER function the repo
-- believed had been revoked.
revoke all on function public.consume_rate_limit(uuid, text[], integer[]) from public;
revoke all on function public.consume_rate_limit(uuid, text[], integer[]) from anon;
revoke all on function public.consume_rate_limit(uuid, text[], integer[]) from authenticated;
grant execute on function public.consume_rate_limit(uuid, text[], integer[]) to service_role;

commit;


-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFY — ONE STANDALONE STATEMENT PER CHECK. Run them ONE AT A TIME (§6): the editor shows
-- only the LAST statement's result, so a pasted block hides every verdict but one.
--
-- ▶ (c)–(e) report through `raise exception`, which Supabase renders RED under "Failed to run
-- sql query". `P0001` means a function raised it deliberately. The message LEADS with that.
-- ═══════════════════════════════════════════════════════════════════════════════

-- VERIFY (a) — the table and its index exist, and RLS is on with NO policies.
--
-- select
--   (select count(*) from information_schema.columns
--     where table_schema='public' and table_name='rate_limit_events')                  as cols,
--   (select count(*) from pg_indexes
--     where schemaname='public' and indexname='rate_limit_events_lookup_idx')          as idx,
--   (select relrowsecurity from pg_class where relname='rate_limit_events')            as rls_on,
--   (select count(*) from pg_policies
--     where schemaname='public' and tablename='rate_limit_events')                     as policies,
--   case when (select count(*) from pg_policies
--               where schemaname='public' and tablename='rate_limit_events') = 0
--        and (select relrowsecurity from pg_class where relname='rate_limit_events')
--       then 'PASS - table present, RLS on, no policies (service role only)'
--       else 'FAIL - see the columns above'
--   end as verdict;


-- VERIFY (b) — the window is rolling, not a clock hour.
--
-- select
--   case when pg_get_functiondef(oid) like '%at > now() - v_window%'
--         and pg_get_functiondef(oid) not like '%date_trunc(''hour''%'
--        then 'PASS - counts a trailing window; no clock-hour truncation remains'
--        else 'FAIL - the old body is still installed'
--   end as verdict
-- from pg_proc where proname = 'consume_rate_limit';


-- VERIFY (c) — ★★ A REFUSAL STILL DOES NOT CHARGE (O113a, preserved). Rolled back.
--
-- do $$
-- declare u uuid := gen_random_uuid(); r jsonb; before_n int; after_n int; v text;
-- begin
--   perform public.consume_rate_limit(u, array['ai'], array[3]);
--   perform public.consume_rate_limit(u, array['ai'], array[3]);
--   perform public.consume_rate_limit(u, array['ai'], array[3]);
--   select count(*) into before_n from public.rate_limit_events where user_id = u and bucket = 'ai';
--   r := public.consume_rate_limit(u, array['ai'], array[3]);   -- must be refused
--   select count(*) into after_n from public.rate_limit_events where user_id = u and bucket = 'ai';
--   v := case when (r->>'allowed')::boolean = false and before_n = 3 and after_n = 3
--             then 'PASS - refused at the limit, and the refusal was NOT charged (3 → 3)'
--             else 'FAIL - allowed=' || (r->>'allowed') || ', count ' || before_n || ' → ' || after_n
--        end;
--   raise exception 'CHECK RESULT (not an error — this rolled back on purpose): %', v;
-- end $$;


-- VERIFY (d) — ★★★ THE POINT OF THE MIGRATION: the reset time is REAL, not "top of the hour".
-- Charges three calls a few minutes apart, then asks when capacity returns.
--
-- do $$
-- declare u uuid := gen_random_uuid(); r jsonb; v text; mins int;
-- begin
--   insert into public.rate_limit_events (user_id, bucket, at) values
--     (u, 'ai', now() - interval '58 minutes'),
--     (u, 'ai', now() - interval '30 minutes'),
--     (u, 'ai', now() - interval '5 minutes');
--   r := public.consume_rate_limit(u, array['ai'], array[3]);
--   mins := (r->>'resets_in_minutes')::int;
--   -- The oldest call ages out in ~2 minutes, so that is when the next one is allowed.
--   v := case when (r->>'allowed')::boolean = false and mins between 1 and 4
--             then 'PASS - capacity returns in ' || mins || ' minute(s), not at the top of the hour'
--             else 'FAIL - allowed=' || (r->>'allowed') || ', resets_in_minutes=' || coalesce(mins::text,'null')
--        end;
--   raise exception 'CHECK RESULT (not an error — this rolled back on purpose): %', v;
-- end $$;


-- VERIFY (e) — ★★ ALL-OR-NOTHING ACROSS BUCKETS (preserved): a call refused by `upload`
-- must leave NO `ai` charge behind.
--
-- do $$
-- declare u uuid := gen_random_uuid(); r jsonb; ai_n int; v text;
-- begin
--   insert into public.rate_limit_events (user_id, bucket) values (u, 'upload');
--   r := public.consume_rate_limit(u, array['ai','upload'], array[60, 1]);   -- upload is full
--   select count(*) into ai_n from public.rate_limit_events where user_id = u and bucket = 'ai';
--   v := case when (r->>'allowed')::boolean = false and r->>'blocked_bucket' = 'upload' and ai_n = 0
--             then 'PASS - refused by upload, and NO ai charge was left behind'
--             else 'FAIL - allowed=' || (r->>'allowed') || ', blocked=' || coalesce(r->>'blocked_bucket','null') || ', ai rows=' || ai_n
--        end;
--   raise exception 'CHECK RESULT (not an error — this rolled back on purpose): %', v;
-- end $$;
