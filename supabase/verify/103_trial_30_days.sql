-- VERIFY 103 — one self-contained block; the red "ERROR: P0001" it ends with is the verdict, not a failure.
-- Before 103: FAIL (14 days); after: PASS (30 days).
do $$
declare v_id uuid; v_days numeric;
begin
  insert into public.companies (name) values ('verify-103-probe') returning id into v_id;
  select round(extract(epoch from (trial_ends_at - now())) / 86400) into v_days from public.subscriptions where company_id = v_id;
  raise exception 'CHECK RESULT (not an error — this rolled back on purpose): %',
    case when v_days = 30 then 'PASS - a new company gets a 30-day trial' else 'FAIL - a new company''s trial is ' || coalesce(v_days::text, 'missing') || ' days' end;
end $$;
