-- 075_bump_rate_limit_acl.sql
--
-- Revoke EXECUTE on `bump_rate_limit` from `anon` and `authenticated`.
--
-- ★ THE THREAT, NAMED (CLAUDE.md §9 — name the threat, the way you name the reader):
-- `public.bump_rate_limit(uuid, text)` is SECURITY DEFINER, so it bypasses the RLS that is
-- the ONLY thing protecting `public.rate_limit` (021 enables RLS with NO policies —
-- service-role-only by construction). Live `proacl` reads
-- `{postgres=X, anon=X, authenticated=X, service_role=X}`.
--
-- AND IT HAS NO GUARD. This is what makes it worse than the O108 finding-2 case:
-- `seed_company_accounts` also carries a stray `anon=X`, but its FIRST STATEMENT is
-- `is_company_member(...)`, so an unauthenticated caller gets an exception rather than an
-- effect. `bump_rate_limit` checks nothing — it increments whatever `(user_id, bucket)`
-- pair it is handed.
--
-- SO: A CALLER HOLDING ONLY THE PUBLIC ANON KEY CAN CALL
--       select public.bump_rate_limit('<any-user-uuid>', 'ai');
-- SIXTY TIMES AND LOCK THAT USER OUT OF THE AI PATH FOR THE REST OF THE CLOCK HOUR.
-- No authentication, no membership, no audit row — the only trace is a counter that looks
-- exactly like legitimate use. §3 is explicit that the anon key is public BY DESIGN and
-- that RLS is the real boundary; a SECURITY DEFINER function with no guard is a hole
-- straight through that boundary.
--
-- ★★ WHY NOW, WHEN THE GRANT IS PRE-EXISTING: migration `074` DELIBERATELY KEEPS
-- `bump_rate_limit` so the edge function can be rolled back without hitting a missing RPC.
-- That decision converts an oversight into a KNOWING RETENTION, and a hole we have chosen
-- to keep is one we owe a fix. (Operator, 2026-08-26.)
--
-- ▶ SAFE TO APPLY BEFORE **OR** AFTER THE `ai-proxy` DEPLOY, and this is checked rather
--   than assumed: `grep -rn "bump_rate_limit" src/` returns NOTHING, so no client calls it.
--   The proxy calls it as `service_role`, whose grant is preserved below. Before the
--   deploy it keeps working; after the deploy nothing calls it at all.
--
-- NOTE ON `create or replace`: this migration does NOT redefine the function, precisely
-- because `create or replace` PRESERVES the existing ACL (§6) — which is how the stray
-- grant survived every prior migration that touched it. Grants are changed by GRANT and
-- REVOKE, and by nothing else.

begin;

-- `from public` first: a PUBLIC grant flows to every role, so revoking the two named roles
-- while leaving PUBLIC in place would revoke nothing at all.
revoke all    on function public.bump_rate_limit(uuid, text) from public;
revoke all    on function public.bump_rate_limit(uuid, text) from anon;
revoke all    on function public.bump_rate_limit(uuid, text) from authenticated;

-- Re-assert the one grant that must survive. The proxy calls as service_role, and 074's
-- rollback path depends on this function continuing to work.
grant  execute on function public.bump_rate_limit(uuid, text) to service_role;

commit;

-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFY — runnable companion at supabase/verify/075_bump_rate_limit_acl.sql
--
-- (a) acl reads {postgres=X/postgres,service_role=X/postgres} — no anon, no authenticated,
--     matching what 074 already achieved for consume_rate_limit.
-- (b) ★ BEHAVIOURAL: the revoke is watched to REFUSE. Calling as anon must raise
--     "permission denied for function bump_rate_limit". A grant nobody has watched refuse
--     is a grant on paper — the standard 071 and 074 were held to.
-- ═══════════════════════════════════════════════════════════════════════════════
