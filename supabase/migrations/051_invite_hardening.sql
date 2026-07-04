-- =====================================================================
-- 051_invite_hardening.sql
-- CODE REVIEW PASS 6 · CR-33 — team-invite hardening (two gaps in 027):
--   1. accept_invite validated status/expiry but NEVER checked the logged-in
--      user's email against the invited email — any authenticated user holding
--      a valid token could accept an invite meant for someone else. Now bound.
--   2. Nothing prevented many duplicate PENDING invites for the same
--      (company, email). A partial unique index enforces one live invite.
-- Written for review as "049" in CODE_REVIEW.md; applied here as 051 (049/050
-- taken). Idempotent + safe to re-run. Requires 027 (company_invites +
-- accept_invite). No other prerequisites.
-- =====================================================================
begin;

-- 0. Collapse any pre-existing duplicate PENDING invites (keep the newest per
--    company+email, revoke the rest) so the unique index below can be created
--    even if the live table already has duplicates. No-op once deduped.
update public.company_invites ci set status = 'revoked'
where ci.status = 'pending'
  and exists (
    select 1 from public.company_invites o
    where o.company_id = ci.company_id
      and lower(o.email) = lower(ci.email)
      and o.status = 'pending'
      and (o.created_at > ci.created_at
           or (o.created_at = ci.created_at and o.id > ci.id))
  );

-- 1. At most one PENDING invite per email per company. Case-insensitive; only
--    'pending' rows are constrained, so accepted/revoked history is unaffected.
create unique index if not exists company_invites_pending_email_uq
  on public.company_invites (company_id, lower(email))
  where status = 'pending';

-- 2. Bind acceptance to the invited email (a valid token is no longer enough).
create or replace function public.accept_invite(p_token uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inv public.company_invites; v_user uuid := auth.uid(); v_email text; v_role text;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select email into v_email from auth.users where id = v_user;

  select * into inv from public.company_invites where token = p_token;
  if inv.id is null          then raise exception 'invalid invite';      end if;
  if inv.status <> 'pending' then raise exception 'invite already used'; end if;
  if inv.expires_at < now()  then raise exception 'invite expired';      end if;
  if lower(inv.email) <> lower(coalesce(v_email,'')) then
    raise exception 'this invite was sent to a different email address'; end if;

  v_role := lower(coalesce(inv.role, 'member'));
  if v_role not in ('admin','member') then v_role := 'member'; end if;

  if not exists (select 1 from public.company_users
                 where company_id = inv.company_id and user_id = v_user) then
    insert into public.company_users (company_id, user_id, role, accepted_at)
    values (inv.company_id, v_user, v_role, now());
  end if;

  update public.company_invites set status = 'accepted' where id = inv.id;
  return inv.company_id;
end;
$$;
revoke all on function public.accept_invite(uuid) from public;
grant execute on function public.accept_invite(uuid) to authenticated;

commit;
