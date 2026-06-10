-- =====================================================================
-- 027_company_invites.sql
-- Multi-user team invites (Item 20). Owner-only invites; roles admin|member.
-- Apply 001 first (for is_company_member/admin and company_users).
-- =====================================================================
begin;

create extension if not exists "uuid-ossp";

-- ── Owner check (role = 'owner') — invites are owner-only ──
create or replace function public.is_company_owner(cid uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.company_users cu
    where cu.company_id = cid and cu.user_id = auth.uid()
      and cu.accepted_at is not null and cu.role = 'owner'
  );
$$;
revoke all on function public.is_company_owner(uuid) from public;
grant execute on function public.is_company_owner(uuid) to authenticated;

-- ── Invites table ──
create table if not exists public.company_invites (
  id          uuid        default uuid_generate_v4() primary key,
  company_id  uuid        not null references public.companies(id) on delete cascade,
  email       text        not null,
  role        text        not null default 'member',   -- 'admin' | 'member'
  invited_by  uuid        not null,
  token       uuid        default uuid_generate_v4() unique,
  status      text        default 'pending',           -- pending | accepted | revoked
  created_at  timestamptz default now(),
  expires_at  timestamptz default now() + interval '7 days'
);
create index if not exists company_invites_company_idx on public.company_invites (company_id, status);

-- ── RLS: only the company OWNER may see / create / delete its invites ──
alter table public.company_invites enable row level security;

drop policy if exists company_invites_select on public.company_invites;
create policy company_invites_select on public.company_invites
  for select to authenticated using (public.is_company_owner(company_id));

drop policy if exists company_invites_insert on public.company_invites;
create policy company_invites_insert on public.company_invites
  for insert to authenticated
  with check (public.is_company_owner(company_id) and invited_by = auth.uid());

drop policy if exists company_invites_delete on public.company_invites;
create policy company_invites_delete on public.company_invites
  for delete to authenticated using (public.is_company_owner(company_id));
-- (No UPDATE policy: status changes happen only inside accept_invite, below.)

-- ── invite_details(token): minimal info for the pre-login banner ──
create or replace function public.invite_details(p_token uuid)
returns table (company_name text, role text, status text, expired boolean)
language sql security definer set search_path = public, pg_temp as $$
  select c.name::text, ci.role, ci.status, (ci.expires_at < now())
  from public.company_invites ci
  join public.companies c on c.id = ci.company_id
  where ci.token = p_token;
$$;
revoke all on function public.invite_details(uuid) from public;
grant execute on function public.invite_details(uuid) to anon, authenticated;

-- ── accept_invite(token): validate + create membership + mark accepted ──
create or replace function public.accept_invite(p_token uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inv    public.company_invites;
  v_user uuid := auth.uid();
  v_role text;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select * into inv from public.company_invites where token = p_token;
  if inv.id is null          then raise exception 'invalid invite';      end if;
  if inv.status <> 'pending' then raise exception 'invite already used'; end if;
  if inv.expires_at < now()  then raise exception 'invite expired';      end if;

  v_role := lower(coalesce(inv.role, 'member'));
  if v_role not in ('admin', 'member') then v_role := 'member'; end if;

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

-- ── list_company_members(company): members with email/name for the Team tab ──
create or replace function public.list_company_members(p_company uuid)
returns table (user_id uuid, email text, full_name text, role text, accepted_at timestamptz)
language sql security definer set search_path = public, pg_temp as $$
  select cu.user_id, u.email::text,
         coalesce(u.raw_user_meta_data->>'full_name', '')::text,
         cu.role, cu.accepted_at
  from public.company_users cu
  join auth.users u on u.id = cu.user_id
  where cu.company_id = p_company
    and public.is_company_admin(p_company)   -- caller must be owner/admin
  order by cu.accepted_at nulls last;
$$;
revoke all on function public.list_company_members(uuid) from public;
grant execute on function public.list_company_members(uuid) to authenticated;

commit;
