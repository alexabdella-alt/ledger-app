-- ═══════════════════════════════════════════════════════════════════════════════
-- PROBING RLS AS SOMEONE ELSE — THE PREREQUISITE THREE ITEMS WERE WAITING ON.
--
-- ★★ THE UNLOCK, FOUND WHILE VERIFYING `080`: `is_platform_admin()` RESOLVES THE EMAIL
-- FROM `auth.uid()`, SO THE SUPPORT-MODE BYPASS IS KEYED ON WHICH USER A PROBE BORROWS —
-- NOT ON WHO IS SITTING AT THE EDITOR. Set `request.jwt.claims` to another member's uid,
-- switch to the `authenticated` role, and the policies evaluate for THEM. Proven live
-- 2026-08-30: probe (f) returned *"PASS - a non-reviewer (owner) was refused"*.
--
-- These three checks have each been recorded as blocked on "a non-platform-admin test
-- user", which invites now make creatable — but the account was never the real
-- prerequisite. The technique was.
--   · TIER 1 #8  — the sign-off DB-layer rejection, never proved because the operator's
--                  own login CANNOT fail it (§3 Option A).
--   · `066` (d)  — the cross-tenant directory write, attempted as a non-admin.
--   · s4         — the cross-tenant read probe, currently "the memory of an afternoon".
--
-- ▶ EVERY BLOCK ROLLS BACK. Run each as ONE statement. They report through `raise
-- exception`, which the editor prints RED under "Failed to run sql query" — `P0001` means
-- a function raised it deliberately. READ THE MESSAGE; it is the result.
--
-- ▶▶▶ ★★ AND A REFUSAL ONLY COUNTS IF IT IS THE RIGHT REFUSAL. The first draft of this file
-- caught `when others` and called it PASS — so a MISTYPED COLUMN NAME would have been
-- reported as the wall holding. It was not hypothetical: probe (2)'s insert named three
-- columns that do not exist on `universal_vendor_directory`, and would have "passed"
-- without the policy being consulted at all. Only `insufficient_privilege` (42501, what an
-- RLS violation raises) is a PASS; anything else is INCONCLUSIVE and says so. Same rule
-- `076` recorded: any other error is reported as ITSELF, never counted as a pass OR a fail.
--
-- ▶▶ AND EVERY BLOCK REPORTS THE ROLE IT RAN AS. The editor's own session is a superuser
-- that BYPASSES RLS entirely, so a probe that failed to switch would test nothing and
-- report a confident verdict about it.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── (1) TIER 1 #8 — A NON-REVIEWER CANNOT SIGN OFF A PERIOD, AT THE DATABASE ──
-- The UI half was proved live during the O83 drive (the card, button and month-picker all
-- disappear for a viewer). The DATABASE half never was: `is_company_reviewer` passes the
-- platform admin through, so the operator's account cannot fail this test.
do $$
declare v text; who text; c uuid; u uuid; r text;
begin
  select cu.company_id, cu.user_id, cu.role into c, u, r
  from public.company_users cu
  join auth.users au on au.id = cu.user_id
  where cu.accepted_at is not null
    and cu.role not in ('admin','accountant')
    and lower(au.email) <> 'alexabdella@gmail.com'
  limit 1;
  if c is null then
    raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no non-platform-admin, non-reviewer member exists';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  who := current_user;

  begin
    insert into public.period_signoffs (company_id, period, signed_by)
    values (c, '2099-01', u);
    v := 'FAIL - a non-reviewer (' || r || ') SIGNED OFF a period';
  exception
    when insufficient_privilege then v := 'PASS - a non-reviewer (' || r || ') was refused: ' || SQLERRM;
    when others then v := 'INCONCLUSIVE - failed for another reason: ' || SQLERRM;
  end;

  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): % [ran as: %]', v, who;
end $$;


-- ── (2) `066` VERIFY (d) — THE CROSS-TENANT DIRECTORY WRITE ──────────────────
-- `universal_vendor_directory` is the ONE genuinely cross-tenant write in the product: a
-- tenant who could add a row would redirect a vendor's default mapping for EVERY other
-- tenant. `066` asked for the write to be attempted as a non-admin and watched to fail,
-- rather than for the policy text to be trusted. This is that check.
do $$
declare v text; who text; u uuid;
begin
  select cu.user_id into u
  from public.company_users cu
  join auth.users au on au.id = cu.user_id
  where cu.accepted_at is not null
    and lower(au.email) <> 'alexabdella@gmail.com'
  limit 1;
  if u is null then
    raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no non-platform-admin member exists';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  who := current_user;

  begin
    insert into public.universal_vendor_directory
      (entity_key, canonical_name, match_patterns, match_type, default_account_role, notes)
    values ('verify probe vendor', 'Verify Probe Vendor', array['verify probe vendor'],
            'exact', 'uncategorized_expense', 'verify probe');
    v := 'FAIL - a non-platform-admin wrote to the GLOBAL vendor directory';
  exception
    when insufficient_privilege then v := 'PASS - the cross-tenant write was refused: ' || SQLERRM;
    when others then v := 'INCONCLUSIVE - failed for another reason: ' || SQLERRM;
  end;

  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): % [ran as: %]', v, who;
end $$;


-- ── (3) s4 — THE CROSS-TENANT READ, AS A SCRIPT RATHER THAN A MEMORY ─────────
-- ★★ THE ANTI-VACUITY HALF IS THE POINT, AND IT ALREADY EARNED ITS PLACE ON THE FIRST RUN.
-- "0 rows of the other company" is equally consistent with *the wall holds* and with *the
-- query matched nothing for an unrelated reason* — an empty result and a broken query look
-- identical. So this ALSO counts the borrower's OWN rows and refuses to pass on zero.
--
-- Live 2026-08-30 it returned **INCONCLUSIVE - saw 0 of their rows AND 0 of my own**: the
-- only non-platform-admin member owns a company with no entries yet. Without the guard it
-- would have printed PASS and s4 would have been closed on a probe that proved nothing.
--
-- ★ SO THE PROBE GIVES THE BORROWER A ROW OF THEIR OWN, INSIDE THE TRANSACTION IT ROLLS
-- BACK. That is not a workaround for a missing fixture — it is what makes the check
-- self-contained: `mine > 0` now means "RLS let this user see a row that genuinely exists
-- in their company", which is the exact counterpart of `theirs = 0`. Nothing is committed.
do $$
declare v text; who text; mine int; theirs int; u uuid; a uuid; b uuid; seeded uuid;
begin
  select cu.user_id, cu.company_id into u, a
  from public.company_users cu
  join auth.users au on au.id = cu.user_id
  where cu.accepted_at is not null
    and lower(au.email) <> 'alexabdella@gmail.com'
  limit 1;
  if u is null then
    raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no non-platform-admin member exists';
  end if;

  -- A company the borrower is NOT a member of, that actually holds entries. Without the
  -- `having` this could pick an empty company and "prove" isolation against nothing.
  select je.company_id into b
  from public.journal_entries je
  where je.company_id <> a
    and je.deleted_at is null
    and not exists (select 1 from public.company_users x where x.company_id = je.company_id and x.user_id = u)
  group by je.company_id
  having count(*) > 0
  limit 1;
  if b is null then
    raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no other tenant with entries to probe against';
  end if;

  -- The borrower's own row, so the positive half of the check is real. Dated far in the
  -- future and rolled back; `2099-01` cannot collide with a signed period.
  insert into public.journal_entries (company_id, entry_date, description, source, status)
  values (a, date '2099-01-01', 'verify probe - rolled back', 'manual', 'posted')
  returning id into seeded;

  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  who := current_user;

  select count(*) into mine   from public.journal_entries where company_id = a;
  select count(*) into theirs from public.journal_entries where company_id = b;

  if theirs > 0 then
    v := 'FAIL - saw ' || theirs || ' rows belonging to another tenant';
  elsif mine = 0 then
    v := 'INCONCLUSIVE - saw 0 of their rows AND 0 of my own, so this proves nothing';
  else
    v := 'PASS - saw ' || mine || ' of my own rows and 0 of theirs';
  end if;

  raise exception 'CHECK RESULT (not an error - this rolled back on purpose): % [ran as: %]', v, who;
end $$;
