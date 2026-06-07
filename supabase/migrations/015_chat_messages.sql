-- =====================================================================
-- 015_chat_messages.sql
-- Persistent AI CFO chat history + action memory, per company. The last N
-- messages are reloaded into the AI's system prompt so it remembers past
-- conversations and what it did. actions_taken holds the plain-English action
-- summary for each assistant turn (drives both the prompt context and the
-- in-app History timeline).
-- =====================================================================

create table if not exists public.chat_messages (
  id            uuid default uuid_generate_v4() primary key,
  company_id    uuid not null references public.companies(id) on delete cascade,
  role          text not null,                    -- 'user' or 'assistant'
  content       text not null,
  actions_taken jsonb default '[]'::jsonb,
  created_at    timestamptz default now()
);

create index if not exists chat_messages_company_idx on public.chat_messages (company_id, created_at);

alter table public.chat_messages enable row level security;

drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
  for insert to authenticated with check (public.is_company_member(company_id));

drop policy if exists chat_messages_update on public.chat_messages;
create policy chat_messages_update on public.chat_messages
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists chat_messages_delete on public.chat_messages;
create policy chat_messages_delete on public.chat_messages
  for delete to authenticated using (public.is_company_member(company_id));
