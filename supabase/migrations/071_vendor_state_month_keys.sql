-- =====================================================================
-- 071_vendor_state_month_keys.sql  (C201 — closing a schema/JS guard gap)
--
-- `vendor_state.first_seen`, `last_seen` and `demoted_at` are TEXT `'YYYY-MM'`, and
-- that is deliberate: Postgres has no month type, `date` would force a spurious day
-- and drag every comparison back into timezone territory, and `monthsBetween`
-- (`vendorTier.js`) is pure string→integer arithmetic with no `Date` anywhere — the
-- O86 UTC-date-key class avoided by construction rather than by care.
--
-- ── THE GAP THIS CLOSES ─────────────────────────────────────────────────
-- The FORMAT was guarded in JS (`isYm`) and NOT in the schema. Nothing stopped
-- `'nope'`, `'2026-13'` or an ISO timestamp landing in `last_seen` — and the failure
-- would be SILENT rather than loud: `monthsBetween` returns `null` on a malformed
-- input, `applyDormancy` reads that null and declines to decay, and a vendor that
-- should have dropped to DECLARED quietly stays KNOWN on stale pattern data. A tier
-- that is wrong because a string was wrong, with nothing on screen to say so.
--
-- Flagged when `064`'s verification came back rather than slipped in with it, and
-- given its own migration on the operator's instruction — a constraint that changes
-- what the table will accept is not a rider on something else.
--
-- Note `'2026-13'` is rejected by the month range, and `'2026-1'` by the two-digit
-- requirement. This checks SHAPE, not calendar validity beyond the month range;
-- there is no day component to be wrong about.
--
-- Apply after `064`. Idempotent; safe to re-run.
-- =====================================================================
begin;

alter table public.vendor_state drop constraint if exists vendor_state_month_keys_check;
alter table public.vendor_state
  add constraint vendor_state_month_keys_check
  check (
        (first_seen  is null or first_seen  ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
    and (last_seen   is null or last_seen   ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
    and (demoted_at  is null or demoted_at  ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
  );

commit;

-- =====================================================================
-- VERIFY (read-only; paste the output into the report, per §6):
--
--   -- (a) the constraint exists and covers all three columns
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.vendor_state'::regclass
--     and conname = 'vendor_state_month_keys_check';
--   -- expect: one row naming first_seen, last_seen and demoted_at
--
--   -- (b) it REJECTS what it is for. Run inside a transaction and roll back —
--   --     a constraint nobody has seen refuse anything is a constraint on paper.
--   begin;
--     insert into public.vendor_state (company_id, entity_key, tier, last_seen)
--     values ((select id from public.companies limit 1), '__probe__', 'STRANGER', 'nope');
--   rollback;
--   -- expect: ERROR  new row ... violates check constraint "vendor_state_month_keys_check"
--
--   begin;
--     insert into public.vendor_state (company_id, entity_key, tier, last_seen)
--     values ((select id from public.companies limit 1), '__probe__', 'STRANGER', '2026-13');
--   rollback;
--   -- expect: the same ERROR (month out of range)
--
--   -- (c) it ACCEPTS a well-formed key — the constraint must not be so tight it
--   --     blocks the real shape. Roll this back too.
--   begin;
--     insert into public.vendor_state (company_id, entity_key, tier, last_seen)
--     values ((select id from public.companies limit 1), '__probe__', 'STRANGER', '2026-08');
--   rollback;
--   -- expect: INSERT 0 1, then rolled back
--
--   -- (d) nothing already in the table violates it (the table is empty today, so this
--   --     should be trivially true — but assert it rather than assume it)
--   select count(*) from public.vendor_state
--   where (first_seen is not null and first_seen !~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
--      or (last_seen  is not null and last_seen  !~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
--      or (demoted_at is not null and demoted_at !~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
--   -- expect: 0
-- =====================================================================
