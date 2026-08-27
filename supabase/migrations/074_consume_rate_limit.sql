-- 074_consume_rate_limit.sql
--
-- O113a — THE RATE LIMITER CHARGES FOR ITS OWN REFUSALS. Fix the limiter, not the limit.
--
-- `bump_rate_limit` (021) increments and RETURNS the new count; `ai-proxy` then checks
-- `> LIMIT` afterwards. So a call that is refused has already been billed for. This is
-- visible in production data: the 2026-08-25 23:00Z drive hour recorded `ai = 81`
-- against a ceiling of 60 — twenty-one calls charged for doing nothing, against
-- twenty-one invoices that failed. Retrying is therefore ACTIVELY HARMFUL, and nothing
-- in the UI says so, so the user's most natural response to a 429 extends the lockout.
--
-- ★ THERE IS A SECOND INSTANCE OF THE SAME BUG IN THE SAME FUNCTION, and it is why this
-- takes an ARRAY rather than one bucket. Today an upload-tagged call bumps `ai`, passes,
-- then bumps `upload` and is refused there — leaving the `ai` charge in place for a call
-- that never ran. Charging one bucket for a refusal issued by another is the same defect
-- wearing a different hat, so the fix has to be ALL-OR-NOTHING ACROSS BUCKETS.
--
-- ★★ THIS FUNCTION NEVER INCREMENTS A BUCKET IT IS ABOUT TO REFUSE.
-- It reads every bucket first, decides, and only then writes. Being inside one plpgsql
-- function means one transaction, so "decide, then charge" is atomic without a second
-- round trip — and `for update` on the existing rows serialises concurrent callers so
-- two requests cannot both observe 59 and both be allowed.
--
-- `bump_rate_limit` IS DELIBERATELY LEFT IN PLACE, NOT DROPPED. The edge function and
-- the database deploy separately, so the old code must keep working until the new
-- function ships, and a rollback of the edge function must not hit a missing RPC.
--   ▶ ORDERING IS LOAD-BEARING: APPLY THIS MIGRATION **BEFORE** DEPLOYING `ai-proxy`.
--     The reverse order calls a function that does not exist yet and fails every AI
--     request — which is a total outage of the AI path, not a degradation.

begin;

-- p_buckets / p_limits are positionally paired: p_buckets[i] is capped at p_limits[i].
-- Returns:
--   { "allowed": bool, "blocked_bucket": text|null, "counts": {bucket: count},
--     "remaining": {bucket: int} }
-- `remaining` is returned because the function must compute it to make the decision
-- anyway; surfacing what is already known is what lets the caller tell a user how much
-- budget is left instead of only that it ran out.
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
  v_hour      timestamptz := date_trunc('hour', now());
  v_ordered   text[];
  v_bucket    text;
  v_idx       integer;
  v_count     integer;
  v_limit     integer;
  v_blocked   text := null;
  v_counts    jsonb := '{}'::jsonb;
  v_remaining jsonb := '{}'::jsonb;
begin
  if p_user is null or p_buckets is null or p_limits is null
     or array_length(p_buckets, 1) is distinct from array_length(p_limits, 1) then
    raise exception 'consume_rate_limit: buckets and limits must be non-null and the same length';
  end if;

  -- Lock in a STABLE (sorted) order. Two concurrent callers naming the same buckets in
  -- different orders would otherwise be able to deadlock against each other.
  select array_agg(b order by b) into v_ordered
  from unnest(p_buckets) as b;

  -- PASS 1 — ensure a row exists for every bucket and take a lock on it. `on conflict do
  -- nothing` then a locking select, rather than an upsert that increments: this pass must
  -- not change any count, because we have not decided yet.
  foreach v_bucket in array v_ordered loop
    insert into public.rate_limit (user_id, bucket, hour_bucket, count)
    values (p_user, v_bucket, v_hour, 0)
    on conflict (user_id, bucket, hour_bucket) do nothing;

    perform 1 from public.rate_limit
     where user_id = p_user and bucket = v_bucket and hour_bucket = v_hour
     for update;
  end loop;

  -- PASS 2 — DECIDE. Read every bucket against its limit before writing anything.
  for v_idx in 1 .. array_length(p_buckets, 1) loop
    v_bucket := p_buckets[v_idx];
    v_limit  := p_limits[v_idx];

    select count into v_count
      from public.rate_limit
     where user_id = p_user and bucket = v_bucket and hour_bucket = v_hour;
    v_count := coalesce(v_count, 0);

    v_counts    := v_counts    || jsonb_build_object(v_bucket, v_count);
    v_remaining := v_remaining || jsonb_build_object(v_bucket, greatest(0, v_limit - v_count));

    -- `>=` because this call has not been counted yet: at count = limit the budget is
    -- already spent and this request is the one over. (021's `> limit` AFTER incrementing
    -- expressed the same threshold, which is why the boundary does not move.)
    if v_blocked is null and v_count >= v_limit then
      v_blocked := v_bucket;
    end if;
  end loop;

  -- ★ REFUSED → CHARGE NOTHING. This is the entire point of the migration.
  if v_blocked is not null then
    return jsonb_build_object(
      'allowed', false, 'blocked_bucket', v_blocked,
      'counts', v_counts, 'remaining', v_remaining);
  end if;

  -- PASS 3 — ALLOWED → charge every bucket, together.
  v_counts := '{}'::jsonb; v_remaining := '{}'::jsonb;
  for v_idx in 1 .. array_length(p_buckets, 1) loop
    v_bucket := p_buckets[v_idx];
    v_limit  := p_limits[v_idx];

    update public.rate_limit
       set count = count + 1, updated_at = now()
     where user_id = p_user and bucket = v_bucket and hour_bucket = v_hour
    returning count into v_count;

    v_counts    := v_counts    || jsonb_build_object(v_bucket, v_count);
    v_remaining := v_remaining || jsonb_build_object(v_bucket, greatest(0, v_limit - v_count));
  end loop;

  return jsonb_build_object(
    'allowed', true, 'blocked_bucket', null,
    'counts', v_counts, 'remaining', v_remaining);
end;
$$;

-- Same ACL shape as `bump_rate_limit` (021): service role only. The edge function is the
-- only caller, and a client that could call this could spend its own budget to zero.
-- Asserted rather than assumed — see O108 finding 2, where live `anon=X` survived on a
-- SECURITY DEFINER function the repo believed had been revoked.
revoke all on function public.consume_rate_limit(uuid, text[], integer[]) from public;
revoke all on function public.consume_rate_limit(uuid, text[], integer[]) from anon;
revoke all on function public.consume_rate_limit(uuid, text[], integer[]) from authenticated;
grant execute on function public.consume_rate_limit(uuid, text[], integer[]) to service_role;

commit;

-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFY — run AFTER applying. Every block is read-only or rolled back.
--
-- ★ (b) IS THE ONE THAT MATTERS: it makes the limiter REFUSE something and then shows
-- the counter DID NOT MOVE. A limiter nobody has watched refuse without charging is a
-- fix on paper — the same standard migration 071 was held to.
-- ═══════════════════════════════════════════════════════════════════════════════

-- (a) The function exists, and its ACL is service-role only (no anon, no authenticated).
--
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.proacl
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname in ('consume_rate_limit','bump_rate_limit');
-- EXPECT: both present (021's is deliberately kept for rollback safety);
--         consume_rate_limit's proacl shows service_role=X and NOT anon/authenticated.

-- (b) ★ REFUSAL CHARGES NOTHING — the whole migration, proved in a rolled-back txn.
--
-- begin;
--   with u as (select id from auth.users limit 1)
--   insert into public.rate_limit (user_id, bucket, hour_bucket, count)
--   select u.id, 'verify_074', date_trunc('hour', now()), 5 from u
--   on conflict (user_id, bucket, hour_bucket) do update set count = 5;
--
--   -- under the limit → allowed, and the count moves 5 → 6
--   select public.consume_rate_limit((select id from auth.users limit 1),
--                                    array['verify_074'], array[10]) as under_limit;
--   select count as after_allowed from public.rate_limit
--    where bucket = 'verify_074' and hour_bucket = date_trunc('hour', now());
--   -- EXPECT: under_limit -> allowed=true, counts={"verify_074":6}, remaining={"verify_074":4}
--   -- EXPECT: after_allowed = 6
--
--   -- AT the limit → refused, and the count MUST NOT MOVE
--   update public.rate_limit set count = 10
--    where bucket = 'verify_074' and hour_bucket = date_trunc('hour', now());
--   select public.consume_rate_limit((select id from auth.users limit 1),
--                                    array['verify_074'], array[10]) as at_limit;
--   select count as after_refused from public.rate_limit
--    where bucket = 'verify_074' and hour_bucket = date_trunc('hour', now());
--   -- EXPECT: at_limit -> allowed=false, blocked_bucket='verify_074', remaining={"verify_074":0}
--   -- ★ EXPECT: after_refused = 10, NOT 11. Under 021 this would have read 11.
-- rollback;

-- (c) ★ ALL-OR-NOTHING ACROSS BUCKETS — the second instance of the same bug.
--     A call refused on `upload` must not leave an `ai` charge behind.
--
-- begin;
--   with u as (select id from auth.users limit 1)
--   insert into public.rate_limit (user_id, bucket, hour_bucket, count)
--   select u.id, b, date_trunc('hour', now()), c
--     from u, (values ('verify_074_ai', 0), ('verify_074_up', 20)) as v(b, c)
--   on conflict (user_id, bucket, hour_bucket) do update set count = excluded.count;
--
--   select public.consume_rate_limit((select id from auth.users limit 1),
--            array['verify_074_ai','verify_074_up'], array[60, 20]) as mixed;
--   select bucket, count from public.rate_limit
--    where bucket like 'verify_074_%' and hour_bucket = date_trunc('hour', now())
--    order by bucket;
--   -- EXPECT: mixed -> allowed=false, blocked_bucket='verify_074_up'
--   -- ★ EXPECT: verify_074_ai is still 0, NOT 1. Today it would be 1 — charged for a
--   --    call that the upload bucket then refused.
-- rollback;

-- (d) The production evidence this fixes, for the record. Read-only.
--
-- select bucket, hour_bucket, count from public.rate_limit
--  where user_id = (select id from auth.users where email = 'alexabdella@gmail.com')
--    and hour_bucket = '2026-08-25 23:00:00+00'::timestamptz
--  order by bucket;
-- EXPECT: ai = 81 (against a ceiling of 60) and upload = 18. The 21 overage is the bug.
