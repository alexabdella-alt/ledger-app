-- =====================================================================
-- 060_anomaly_attested_resolution.sql
-- C198·3b (f1) — a THIRD way an anomaly can close: the period was attested.
--
-- 056 gave anomalies two exits: 'auto' (the condition disappeared — the next
-- scan noticed, honestly) and 'dismissed' (a human judged this note
-- acceptable, reason required). Sign-off is neither. The condition is still
-- there — the duplicate charge, the round number, the spike are all still in
-- the ledger — so 'auto' is a lie the next scan immediately corrects by
-- re-opening the row (reconcileAnomalies only suppresses re-insert for
-- status='dismissed'). And it is not a dismissal: nobody judged THIS note,
-- they attested the MONTH over it, so folding it into 'dismissed' would feed
-- priorDismissalFor (C195(3)) and silently downgrade later duplicates for the
-- same vendor+amount — turning alarm-fatigue suppression into a real miss.
--
-- 'attested' is therefore its own exit: closed by the act of sign-off,
-- suppresses re-insert like a dismissal, carries no human vendor judgement.
-- HIGH anomalies are never attested away — they BLOCK sign-off (controlTotals
-- signOffReadiness), so they cannot be open at the moment this fires.
-- Apply 056 first.
-- =====================================================================
begin;

alter table public.anomalies
  drop constraint if exists anomalies_resolution_check;

alter table public.anomalies
  add constraint anomalies_resolution_check
  check (resolution in ('auto','dismissed','attested'));

-- The period whose sign-off retired this note (YYYY-MM). NULL for every other
-- resolution. Kept as its own column rather than parsed back out of prose so
-- the "why did this close" answer is queryable, and so a REVOKED sign-off can
-- find exactly the rows it should re-open — revoking month M re-opens the rows
-- M attested and leaves every other month's alone.
alter table public.anomalies
  add column if not exists attested_period text;

create index if not exists anomalies_attested_period_idx
  on public.anomalies (company_id, attested_period)
  where resolution = 'attested';

commit;
