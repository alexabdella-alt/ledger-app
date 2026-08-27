-- 074 VERIFY — blocks (b) and (c), restructured to return ONE verdict table each.
--
-- ★ PASTE EACH BLOCK WHOLE. "One at a time" means ONE BLOCK at a time, not one statement:
-- the `rollback` is what makes these safe, and a statement pasted on its own runs in its
-- own transaction and COMMITS. If you do run them piecemeal, the cleanup at the bottom
-- removes what is left.
--
-- Each block ends in a single SELECT that computes PASS/FAIL, so the editor's
-- last-result-wins behaviour shows you the answer instead of an intermediate count.


-- ══════════════════════════════════════════════════════════════════════════════
-- BLOCK (b) — A REFUSAL CHARGES NOTHING.  Expect 4 rows, all PASS.
-- ══════════════════════════════════════════════════════════════════════════════

begin;

create temp table v074b (step text primary key, detail jsonb) on commit drop;

with u as (select id from auth.users order by created_at limit 1)
insert into public.rate_limit (user_id, bucket, hour_bucket, count)
select u.id, 'verify_074', date_trunc('hour', now()), 5 from u
on conflict (user_id, bucket, hour_bucket) do update set count = 5;

insert into v074b
select '1_under_limit',
       public.consume_rate_limit((select id from auth.users order by created_at limit 1),
                                 array['verify_074'], array[10]);

insert into v074b
select '2_after_allowed', to_jsonb(count)
  from public.rate_limit
 where bucket = 'verify_074' and hour_bucket = date_trunc('hour', now());

update public.rate_limit set count = 10
 where bucket = 'verify_074' and hour_bucket = date_trunc('hour', now());

insert into v074b
select '3_at_limit',
       public.consume_rate_limit((select id from auth.users order by created_at limit 1),
                                 array['verify_074'], array[10]);

insert into v074b
select '4_after_refused', to_jsonb(count)
  from public.rate_limit
 where bucket = 'verify_074' and hour_bucket = date_trunc('hour', now());

select step,
       detail,
       case step
         when '1_under_limit'   then case when (detail->>'allowed')::boolean
                                     then 'PASS' else 'FAIL - expected allowed=true' end
         when '2_after_allowed' then case when detail::text = '6'
                                     then 'PASS' else 'FAIL - expected 6, got ' || detail::text end
         when '3_at_limit'      then case when not (detail->>'allowed')::boolean
                                               and detail->>'blocked_bucket' = 'verify_074'
                                     then 'PASS' else 'FAIL - expected allowed=false' end
         when '4_after_refused' then case when detail::text = '10'
                                     then 'PASS - the fix: refused and NOT charged'
                                     else 'FAIL - expected 10, got ' || detail::text || ' (021 behaviour: charged for a refusal)' end
       end as verdict
  from v074b
 order by step;

rollback;


-- ══════════════════════════════════════════════════════════════════════════════
-- BLOCK (c) — ALL-OR-NOTHING ACROSS BUCKETS.  Expect 2 rows, both PASS.
-- A call refused on `upload` must leave NO charge on `ai`.
-- ══════════════════════════════════════════════════════════════════════════════

begin;

create temp table v074c (step text primary key, detail jsonb) on commit drop;

with u as (select id from auth.users order by created_at limit 1)
insert into public.rate_limit (user_id, bucket, hour_bucket, count)
select u.id, v.b, date_trunc('hour', now()), v.c
  from u, (values ('verify_074_ai', 0), ('verify_074_up', 20)) as v(b, c)
on conflict (user_id, bucket, hour_bucket) do update set count = excluded.count;

insert into v074c
select '1_mixed',
       public.consume_rate_limit((select id from auth.users order by created_at limit 1),
                                 array['verify_074_ai', 'verify_074_up'], array[60, 20]);

insert into v074c
select '2_ai_after', to_jsonb(count)
  from public.rate_limit
 where bucket = 'verify_074_ai' and hour_bucket = date_trunc('hour', now());

select step,
       detail,
       case step
         when '1_mixed'    then case when not (detail->>'allowed')::boolean
                                          and detail->>'blocked_bucket' = 'verify_074_up'
                                then 'PASS' else 'FAIL - expected refusal blamed on verify_074_up' end
         when '2_ai_after' then case when detail::text = '0'
                                then 'PASS - ai NOT charged for a call upload refused'
                                else 'FAIL - ai was charged ' || detail::text || ' for a refused call' end
       end as verdict
  from v074c
 order by step;

rollback;


-- ══════════════════════════════════════════════════════════════════════════════
-- CLEANUP — expect 0 rows. Only needed if a block was run piecemeal and committed.
-- ══════════════════════════════════════════════════════════════════════════════

delete from public.rate_limit where bucket like 'verify_074%';

select bucket, hour_bucket, count from public.rate_limit where bucket like 'verify_074%';
