-- =====================================================================
-- 033_notifications.sql
-- In-app notification feed (bell menu). Found during the schema-drift audit:
-- the client has always read/written public.notifications (App.jsx
-- loadNotifications / pushNotificationRow / markNotifRead / clearAllNotifs),
-- but NO migration ever created the table — it was relied upon to exist by
-- hand. Every call is wrapped in try/catch ("table may be absent"), so on any
-- database without the hand-created table the entire notifications feature
-- silently no-ops. This migration creates it with full tenant isolation so the
-- feature works on a fresh database.
--
-- RLS: standard is_company_member isolation, all four policies (the client
-- inserts, selects, and updates read/dismissed flags). Apply 001 first.
-- =====================================================================
begin;

create extension if not exists "uuid-ossp";

create table if not exists public.notifications (
  id          uuid        default uuid_generate_v4() primary key,
  company_id  uuid        not null references public.companies(id) on delete cascade,
  type        text        not null,            -- monthly_report | anomaly | ap_due | ... (also used for 24h dedup)
  title       text,
  description text,
  link_view   text,                            -- optional view to navigate to on click
  read        boolean     default false,
  dismissed   boolean     default false,
  created_at  timestamptz default now()
);
create index if not exists notifications_company_idx
  on public.notifications (company_id, created_at desc);
-- supports the "same-type within 24h" dedup lookup
create index if not exists notifications_company_type_idx
  on public.notifications (company_id, type, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications
  for insert to authenticated with check (public.is_company_member(company_id));

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete to authenticated using (public.is_company_member(company_id));

commit;
