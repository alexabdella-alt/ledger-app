-- ═══════════════════════════════════════════════════════════════════════════════
-- 080 — VERIFY THE DISMISSAL GATE. Self-contained: creates its own probe row.
--
-- ★★ WHY THE FIRST VERSION OF THESE PROBES WAS NOT SOUND, RECORDED BECAUSE IT ALMOST
-- SHIPPED: `080`'s in-file VERIFY (c)/(d) just ran an UPDATE. **The Supabase SQL editor
-- runs as a superuser role, which BYPASSES RLS**, so the update would have been permitted
-- regardless of the policy and (c) would have reported `FAIL - a dismissal with NO REASON
-- was accepted` against a perfectly correct migration. A false FAIL on a correct guard is
-- the mirror of a false PASS on a broken one, and both come from testing something other
-- than the thing you named.
--
-- So these switch to the `authenticated` role with a real member's uid before probing, and
-- **report the role they actually ran as**, so a switch that silently failed cannot be read
-- as a result. They also create the row they need, rather than reporting INCONCLUSIVE when
-- the queue happens to be clean.
--
-- Everything rolls back — the final `raise exception` aborts the transaction, so no probe
-- anomaly is ever committed. Run each block as ONE statement.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── (c) A DISMISSAL WITH NO REASON IS REFUSED ────────────────────────────────
do $$
declare v text; who text; a uuid; c uuid; u uuid;
begin
  select cu.company_id, cu.user_id into c, u
  from public.company_users cu
  where cu.accepted_at is not null and cu.role in ('admin','accountant','owner')
  limit 1;
  if c is null then
    raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no accepted company membership to borrow';
  end if;

  insert into public.anomalies (company_id, type, severity, status, fingerprint, title, detail)
  values (c, 'verify_080_probe', 'low', 'open', 'verify-080-' || gen_random_uuid()::text, 'probe', 'probe')
  returning id into a;

  -- Become a normal user, so the policies actually apply to us.
  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  who := current_user;

  begin
    update public.anomalies set status = 'dismissed', dismissed_reason = null where id = a;
    v := 'FAIL - a dismissal with NO REASON was accepted';
  exception when others then
    v := 'PASS - refused: ' || SQLERRM;
  end;

  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): % [ran as: %]', v, who;
end $$;


-- ── (d) ★ AND ORDINARY HOUSEKEEPING STILL WORKS ──────────────────────────────
-- Without this, (c) passing is equally consistent with "we gated dismissal" and "we broke
-- every other update" — the `079` failure exactly. Auto-resolve, sign-off expiry, reopen
-- and last_seen bumps all run as whoever is logged in, including an OWNER, who is NOT a
-- reviewer. This is the check that proves they were not collateral damage.
do $$
declare v text; who text; a uuid; c uuid; u uuid;
begin
  select cu.company_id, cu.user_id into c, u
  from public.company_users cu
  where cu.accepted_at is not null and cu.role in ('admin','accountant','owner')
  limit 1;
  if c is null then
    raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no accepted company membership to borrow';
  end if;

  insert into public.anomalies (company_id, type, severity, status, fingerprint, title, detail)
  values (c, 'verify_080_probe', 'low', 'open', 'verify-080-' || gen_random_uuid()::text, 'probe', 'probe')
  returning id into a;

  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  who := current_user;

  begin
    update public.anomalies set last_seen_at = now() where id = a;
    v := 'PASS - ordinary anomaly housekeeping still works';
  exception when others then
    v := 'FAIL - a non-dismissal update was blocked: ' || SQLERRM;
  end;

  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): % [ran as: %]', v, who;
end $$;


-- ── (e) THE POLICY AS THE DATABASE ACTUALLY HOLDS IT ─────────────────────────
-- A plain catalog read, no probe. Independent of whether the role switch above worked, and
-- the one check that cannot be defeated by the session's own privileges.
select
  cmd,
  case
    when qual is not null
     and with_check like '%is_company_reviewer%'
     and with_check like '%dismissed_reason%'
     and with_check like '%status IS DISTINCT FROM%'
      then 'PASS - dismissal requires a reviewer AND a reason; other updates untouched'
    else 'FAIL - see with_check below'
  end as verdict,
  with_check
from pg_policies
where tablename = 'anomalies' and cmd = 'UPDATE';
