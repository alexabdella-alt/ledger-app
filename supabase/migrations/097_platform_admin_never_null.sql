-- ═══════════════════════════════════════════════════════════════════════════════
-- 097 — `is_platform_admin()` ANSWERS false, NEVER NULL. Apply AFTER 096.
--
-- For a caller with no session and no email the function returned NULL, and every guard
-- written `if not public.is_platform_admin() then raise` (and `is_company_member`, which
-- ORs it in) silently let that caller through. 096 took the functions away from signed-out
-- callers; this removes the trap itself, so a future guard written the same way is safe
-- and a signed-in account with no email (not possible today — email sign-up only) could not
-- revive it.
--
-- ★ §6: A LIVE FUNCTION IS REPLACED BY COPY, NEVER BY RECONSTRUCTION. This file cannot read
--   live, so it CHECKS: the first block compares the live body with the text this file was
--   written from (the baseline dump) and REFUSES — writing nothing — if they differ. The
--   only change is the outer `coalesce(…, false)`. `create or replace` keeps the grants.
-- VERIFY: supabase/verify/096_doors.sql (E).
-- ═══════════════════════════════════════════════════════════════════════════════
begin;

do $$
declare
  live text;
  expected text := $body$
  select lower(coalesce(
           (select u.email from auth.users u where u.id = auth.uid()),
           auth.jwt() ->> 'email'
         )) = any (array['alexabdella@gmail.com']);
$body$;
begin
  select regexp_replace(btrim(p.prosrc), '\s+', ' ', 'g') into live
  from pg_proc p where p.oid = 'public.is_platform_admin()'::regprocedure;
  if live is distinct from regexp_replace(btrim(expected), '\s+', ' ', 'g') then
    raise exception '097 NOT APPLIED - nothing was changed. The live is_platform_admin() is not the text this file was written from. Send this back so the file can be corrected. LIVE BODY: %', live;
  end if;
end $$;

create or replace function public.is_platform_admin() returns boolean
    language sql stable security definer
    set search_path to 'public', 'auth', 'pg_temp'
    as $$
  select coalesce(lower(coalesce(
           (select u.email from auth.users u where u.id = auth.uid()),
           auth.jwt() ->> 'email'
         )) = any (array['alexabdella@gmail.com']), false);
$$;

commit;
