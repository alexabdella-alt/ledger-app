-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFY 074_consume_rate_limit.sql — RUNNABLE AS-IS. Paste the whole file.
--
-- ★ DELIBERATELY NOT IN supabase/migrations/. A file named `074_verify.sql` beside
--   `074_consume_rate_limit.sql` shares a numeric prefix, and §6 records what that costs:
--   a duplicate `051` once caused a migration to be SKIPPED. Nothing in this directory is
--   ever applied as a migration.
--
-- Every statement below is read-only or inside a transaction that ROLLS BACK.
-- Block (b) is the one that matters: it makes the limiter REFUSE something and then shows
-- the counter DID NOT MOVE. A limiter nobody has watched refuse without charging is a fix
-- on paper — the standard migration 071 was held to.
-- ═══════════════════════════════════════════════════════════════════════════════


-- ── (a) The function exists, and its ACL is service-role only ──────────────────
-- EXPECT: both rows present — 021's bump_rate_limit is deliberately kept for rollback
--         safety — and consume_rate_limit's proacl shows service_role=X with NO anon and
--         NO authenticated. (O108 finding 2: live `anon=X` once survived on a SECURITY
--         DEFINER function the repo believed had been revoked. Read it, don't assume it.)

select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef                               as security_definer,
       p.proacl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('consume_rate_limit', 'bump_rate_limit')
 order by p.proname;


-- ── (b) ★ THE ONE THAT MATTERS — A REFUSAL CHARGES NOTHING ─────────────────────
-- Rolled back, so no counter is left behind.
--
-- EXPECT  under_limit    -> allowed=true,  counts={"verify_074":6},  remaining={"verify_074":4}
-- EXPECT  after_allowed  = 6
-- EXPECT  at_limit       -> allowed=false, blocked_bucket="verify_074", remaining={"verify_074":0}
-- ★ EXPECT after_refused = 10, NOT 11.   Under 021 this would have read 11. That
--                                        difference IS the fix.

begin;

  with u as (select id from auth.users order by created_at limit 1)
  insert into public.rate_limit (user_id, bucket, hour_bucket, count)
  select u.id, 'verify_074', date_trunc('hour', now()), 5 from u
  on conflict (user_id, bucket, hour_bucket) do update set count = 5;

  -- under the limit → allowed, and the count moves 5 → 6
  select public.consume_rate_limit(
           (select id from auth.users order by created_at limit 1),
           array['verify_074'], array[10]
         ) as under_limit;

  select count as after_allowed
    from public.rate_limit
   where bucket = 'verify_074' and hour_bucket = date_trunc('hour', now());

  -- now sit exactly AT the limit → refused, and the count MUST NOT MOVE
  update public.rate_limit set count = 10
   where bucket = 'verify_074' and hour_bucket = date_trunc('hour', now());

  select public.consume_rate_limit(
           (select id from auth.users order by created_at limit 1),
           array['verify_074'], array[10]
         ) as at_limit;

  select count as after_refused
    from public.rate_limit
   where bucket = 'verify_074' and hour_bucket = date_trunc('hour', now());

rollback;


-- ── (c) ★ ALL-OR-NOTHING ACROSS BUCKETS — the second instance of the same bug ───
-- A call refused on `upload` must leave NO charge on `ai`. Today it does leave one.
--
-- EXPECT  mixed -> allowed=false, blocked_bucket="verify_074_up"
-- ★ EXPECT verify_074_ai is still 0, NOT 1 — it must not be charged for a call the
--          upload bucket then refused.

begin;

  with u as (select id from auth.users order by created_at limit 1)
  insert into public.rate_limit (user_id, bucket, hour_bucket, count)
  select u.id, v.b, date_trunc('hour', now()), v.c
    from u, (values ('verify_074_ai', 0), ('verify_074_up', 20)) as v(b, c)
  on conflict (user_id, bucket, hour_bucket) do update set count = excluded.count;

  select public.consume_rate_limit(
           (select id from auth.users order by created_at limit 1),
           array['verify_074_ai', 'verify_074_up'], array[60, 20]
         ) as mixed;

  select bucket, count
    from public.rate_limit
   where bucket like 'verify_074_%' and hour_bucket = date_trunc('hour', now())
   order by bucket;

rollback;


-- ── (d) The production evidence this fixes, for the record. Read-only. ─────────
-- EXPECT: ai = 81 against a ceiling of 60, and upload = 18 against a ceiling of 20.
--         The 21 overage is the bug — 21 calls charged for doing nothing, against the
--         21 invoices that failed in the drive.

select bucket, hour_bucket, count
  from public.rate_limit
 where user_id = (select id from auth.users where email = 'alexabdella@gmail.com')
   and hour_bucket = '2026-08-25 23:00:00+00'::timestamptz
 order by bucket;


-- ── (e) Nothing was left behind by (b) or (c). ────────────────────────────────
-- EXPECT: 0 rows. Both blocks rolled back; if anything survives, a block did not.

select bucket, hour_bucket, count
  from public.rate_limit
 where bucket like 'verify_074%';
