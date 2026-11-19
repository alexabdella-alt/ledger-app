-- VERIFY 101 — the scheduled lost-upload check. ONE STATEMENT PER CHECK; paste each on its own
-- (the Supabase editor shows only the last statement's result). Each returns one verdict row.
-- Before 101 is applied, (A)–(C) say FAIL; after, PASS. (D) needs 15 minutes after applying.

-- (A) installed: pg_cron + pg_net present, the function and its alert table exist
select case
  when (select count(*) from pg_extension where extname in ('pg_cron', 'pg_net')) = 2
   and to_regprocedure('ops.check_intake_holes(boolean)') is not null
   and to_regclass('ops.intake_alerts') is not null
  then 'PASS - pg_cron, pg_net, ops.check_intake_holes and ops.intake_alerts all present'
  else 'FAIL - missing: ' || concat_ws(', ',
    case when not exists (select 1 from pg_extension where extname = 'pg_cron') then 'pg_cron' end,
    case when not exists (select 1 from pg_extension where extname = 'pg_net') then 'pg_net' end,
    case when to_regprocedure('ops.check_intake_holes(boolean)') is null then 'ops.check_intake_holes' end,
    case when to_regclass('ops.intake_alerts') is null then 'ops.intake_alerts' end)
end as verdict;

-- (B) scheduled every 15 minutes and active
select case
  when exists (select 1 from cron.job where jobname = 'shadow-intake-check' and schedule = '*/15 * * * *'
                 and active and command ilike '%ops.check_intake_holes()%')
  then 'PASS - job shadow-intake-check runs every 15 minutes'
  else 'FAIL - no active shadow-intake-check job on */15'
end as verdict;

-- (C) the app's API cannot reach it (Postgres's own resolver, not an ACL regex)
select case
  when to_regprocedure('ops.check_intake_holes(boolean)') is null then 'FAIL - function not installed'
  when has_function_privilege('anon', 'ops.check_intake_holes(boolean)', 'EXECUTE')
    or has_function_privilege('authenticated', 'ops.check_intake_holes(boolean)', 'EXECUTE')
    or has_schema_privilege('anon', 'ops', 'USAGE')
    or has_schema_privilege('authenticated', 'ops', 'USAGE')
  then 'FAIL - anon/authenticated can reach schema ops or execute the check'
  else 'PASS - anon and authenticated have no usage on ops and no execute on the check'
end as verdict;

-- (D) it has actually run, and its last run succeeded (wait 15 minutes after applying)
select coalesce((
  select case when d.status = 'succeeded'
              then 'PASS - last run succeeded at ' || to_char(d.end_time at time zone 'America/Chicago', 'YYYY-MM-DD HH24:MI') || ' Central'
              else 'FAIL - last run ' || d.status || ': ' || coalesce(d.return_message, '') end
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
   where j.jobname = 'shadow-intake-check'
   order by d.start_time desc limit 1),
  'NOT YET - no run recorded; wait for the next quarter hour') as verdict;

-- (E) the check SEES a lost upload — a rolled-back probe. One self-contained block; the red
-- "ERROR: P0001" it ends with is the verdict, not a failure. Uses dry-run: nothing is sent.
do $$
declare v_co uuid; v_id uuid; v_hit int;
begin
  select id into v_co from public.companies order by id limit 1;
  insert into public.document_intake (company_id, filename, status, received_at)
  values (v_co, 'verify-101-probe.pdf', 'received', now() - interval '2 hours') returning id into v_id;
  select count(*) into v_hit from ops.check_intake_holes(true) c where c.company_id = v_co and c.kind = 'upload_stuck';
  raise exception 'CHECK RESULT (not an error — this rolled back on purpose): %',
    case when v_hit = 1 then 'PASS - a 2-hour-old unfinished upload is reported as upload_stuck'
         else 'FAIL - the stuck probe was not reported' end;
end $$;

-- (F) delivery so far: alerts Sentry confirmed vs still waiting (informational)
select 'INFO - ' || count(*) filter (where delivered) || ' delivered to Sentry, '
       || count(*) filter (where not delivered) || ' awaiting confirmation' as verdict
  from ops.intake_alerts;
