-- ═══════════════════════════════════════════════════════════════════════════════
-- 087 — A DAILY CAP BESIDE THE HOURLY ONE.
--
-- WHY: with ONE window there is no bound on total damage. A compromised account runs the
-- hourly limit forever — 60 × 24 = 1,440 AI calls a day, indefinitely, and nothing ever
-- stops it — while a legitimate first upload is refused four minutes in (measured: the
-- Red River drive, 2026-09-02, 20 of 35 documents refused at 04:39). The instrument
-- barely inconveniences a patient attacker and completely blocks an impatient customer.
--
-- ★ SO THE TWO WINDOWS BOUND DIFFERENT THINGS, AND NEITHER SUBSTITUTES FOR THE OTHER:
--     · the HOUR bounds the BURST RATE — how fast one account can spend.
--     · the DAY bounds TOTAL DAMAGE — the number that decides whether a stolen account
--       costs a few dollars or a few thousand.
--   Raising the hourly without adding the daily would remove the only brake we have.
--
-- ★★ THE PRUNE IS THE LOAD-BEARING CHANGE, AND GETTING IT WRONG WOULD BE INVISIBLE.
--   `086` deletes anything older than the window, and its window was one hour. Add a daily
--   cap on top of an HOURLY prune and the daily count can never exceed the hourly count —
--   the cap becomes permanently unreachable, and a limiter that cannot fire looks exactly
--   like a limiter with nothing to refuse (the C195(7) shape, in the one place where the
--   failure is silent AND expensive). Retention now follows the WIDEST window.
--
-- ★ NEW SIGNATURE, OLD FUNCTION LEFT IN PLACE — the `086` deploy-ordering discipline.
--   The 3-arg form keeps working, so the migration can go live BEFORE the proxy and the
--   product runs correctly in the gap. `074` could not do that; this can, deliberately.
-- ═══════════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.consume_rate_limit(
  p_user         uuid,
  p_buckets      text[],
  p_limits       integer[],      -- per-bucket, per HOUR
  p_daily_limits integer[]       -- per-bucket, per DAY
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hour      interval := interval '1 hour';
  v_day       interval := interval '24 hours';
  v_retain    interval := interval '24 hours';   -- ★ the WIDEST window, never the narrowest
  v_bucket    text;
  v_idx       integer;
  v_hcount    integer;
  v_dcount    integer;
  v_blocked   text := null;
  v_bwindow   text := null;
  v_blimit    integer := null;
  v_bcount    integer := null;
  v_bint      interval := null;
  v_oldest    timestamptz;
  v_resets    integer := null;
  v_counts    jsonb := '{}'::jsonb;
  v_remaining jsonb := '{}'::jsonb;
begin
  if p_user is null or p_buckets is null or p_limits is null or p_daily_limits is null
     or array_length(p_buckets, 1) is distinct from array_length(p_limits, 1)
     or array_length(p_buckets, 1) is distinct from array_length(p_daily_limits, 1) then
    raise exception 'consume_rate_limit: buckets, limits and daily_limits must be non-null and the same length';
  end if;

  -- Serialise per user (086): with events there is no single row to lock, so an advisory
  -- lock does the same job — two concurrent requests cannot both observe the limit-1 and
  -- both be allowed. Keyed on the user, so different users never contend.
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));

  -- ★★ RETENTION FOLLOWS THE WIDEST WINDOW. Pruning at one hour would make the daily count
  -- a copy of the hourly one and the daily cap unreachable — a limit that exists, reads
  -- correctly, and can never fire. Bounded: at most 24h of one user's calls.
  delete from public.rate_limit_events
   where user_id = p_user and at <= now() - v_retain;

  -- ── PASS 1 — DECIDE, ACROSS BOTH WINDOWS, BEFORE WRITING ANYTHING. ──────────
  -- This ordering is the whole of `O113a`, now extended: a refusal issued by the DAY must
  -- not charge the HOUR, and a refusal by either must not charge a bucket that passed.
  for v_idx in 1 .. array_length(p_buckets, 1) loop
    v_bucket := p_buckets[v_idx];

    select count(*) into v_hcount from public.rate_limit_events
     where user_id = p_user and bucket = v_bucket and at > now() - v_hour;
    select count(*) into v_dcount from public.rate_limit_events
     where user_id = p_user and bucket = v_bucket and at > now() - v_day;

    -- ★ REMAINING IS THE MIN ACROSS WINDOWS — what the caller can ACTUALLY do next.
    -- Reporting the hourly headroom while the daily is exhausted would be a budget
    -- display that is true about one window and wrong about the answer.
    v_counts := v_counts || jsonb_build_object(v_bucket, v_hcount);
    v_remaining := v_remaining || jsonb_build_object(v_bucket, greatest(0, least(
      p_limits[v_idx] - v_hcount, p_daily_limits[v_idx] - v_dcount)));

    if v_blocked is null and v_dcount >= p_daily_limits[v_idx] then
      v_blocked := v_bucket; v_bwindow := 'day';
      v_blimit := p_daily_limits[v_idx]; v_bcount := v_dcount; v_bint := v_day;
    elsif v_blocked is null and v_hcount >= p_limits[v_idx] then
      v_blocked := v_bucket; v_bwindow := 'hour';
      v_blimit := p_limits[v_idx]; v_bcount := v_hcount; v_bint := v_hour;
    end if;
  end loop;

  if v_blocked is not null then
    -- The real reset time, for WHICHEVER window blocked: capacity returns when enough of
    -- the oldest calls age out of THAT window. A daily block is honestly hours away, and
    -- saying so beats a comfortable number that is wrong.
    select at into v_oldest
      from public.rate_limit_events
     where user_id = p_user and bucket = v_blocked and at > now() - v_bint
     order by at
    offset greatest(0, v_bcount - v_blimit)
     limit 1;

    v_resets := greatest(0, ceil(extract(epoch from ((v_oldest + v_bint) - now())) / 60.0))::integer;

    -- NOTHING was charged. Not the blocked bucket, not the blocked window, not the
    -- buckets that passed.
    return jsonb_build_object(
      'allowed', false, 'blocked_bucket', v_blocked, 'blocked_window', v_bwindow,
      'counts', v_counts, 'remaining', v_remaining,
      'resets_in_minutes', v_resets);
  end if;

  -- ── PASS 2 — ALLOWED → charge every bucket, together. ───────────────────────
  v_counts := '{}'::jsonb; v_remaining := '{}'::jsonb;
  for v_idx in 1 .. array_length(p_buckets, 1) loop
    v_bucket := p_buckets[v_idx];

    insert into public.rate_limit_events (user_id, bucket) values (p_user, v_bucket);

    select count(*) into v_hcount from public.rate_limit_events
     where user_id = p_user and bucket = v_bucket and at > now() - v_hour;
    select count(*) into v_dcount from public.rate_limit_events
     where user_id = p_user and bucket = v_bucket and at > now() - v_day;

    v_counts    := v_counts    || jsonb_build_object(v_bucket, v_hcount);
    v_remaining := v_remaining || jsonb_build_object(v_bucket, greatest(0, least(
      p_limits[v_idx] - v_hcount, p_daily_limits[v_idx] - v_dcount)));
  end loop;

  return jsonb_build_object(
    'allowed', true, 'blocked_bucket', null, 'blocked_window', null,
    'counts', v_counts, 'remaining', v_remaining,
    'resets_in_minutes', null);
end;
$$;

-- Service role only. Asserted rather than assumed — O108 finding 2 is the precedent, where
-- a live `anon=X` survived on a SECURITY DEFINER function the repo believed was revoked.
revoke all on function public.consume_rate_limit(uuid, text[], integer[], integer[]) from public;
revoke all on function public.consume_rate_limit(uuid, text[], integer[], integer[]) from anon;
revoke all on function public.consume_rate_limit(uuid, text[], integer[], integer[]) from authenticated;
grant execute on function public.consume_rate_limit(uuid, text[], integer[], integer[]) to service_role;

commit;
