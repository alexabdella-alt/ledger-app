-- ═══════════════════════════════════════════════════════════════════════════════
-- 098 — THREE LIVE PROBLEMS FOUND BY THE 2026-11-12 REVIEW, CONFIRMED AGAINST LIVE 2026-11-13.
--
-- (S6) AN ACCOUNTANT OR VIEWER INVITE COULD NEVER BE ACCEPTED. Live `accept_invite` turned
--      every role but 'admin' into 'member' — which `company_users_role_check` (owner, admin,
--      accountant, viewer) rejects. Invites are created as admin / accountant / viewer
--      (`company_invites_role_check`), so the first accountant anyone invited would have hit
--      a database error. No invite exists yet (0 rows), so nobody has. Now each allowed role
--      is kept; a legacy 'member' is 'viewer' (C225: the app's "member" was the DB's viewer);
--      anything else is 'viewer'. An invite never makes an owner.
-- (S5) A JOURNAL LINE COULD BE MOVED OUT OF A SIGNED-OFF MONTH. The line guard returned early
--      on any UPDATE that left account/debit/credit alone — including one that changed
--      `journal_entry_id` — and checked only the entry the line went TO. Now a move is not
--      exempt, and the entry the line LEAVES is checked too.
-- (S4, part) A VIEW-ONLY MEMBER COULD RECORD ENTRIES. `post_journal_entry` (SECURITY DEFINER,
--      so past the lines table's writer-only rule) checked `is_company_member`. It now checks
--      `is_company_writer` (owner / admin / accountant, or the platform admin). Confirmed
--      first: every live membership is an accepted owner or admin, so no one who records
--      entries today loses that. *(S4's table rules for categories, contacts, vendor rules,
--      bank accounts, documents, intake and anomalies are NOT changed here — the app writes
--      some of those in the background for every signed-in user; that needs its own change.)*
--
-- ★ §6: EACH BODY IS THE LIVE TEXT (pg_get_functiondef, 2026-11-13) WITH A MINIMAL EDIT, AND
--   THE FIRST BLOCK REFUSES — CHANGING NOTHING — IF ANY LIVE BODY HAS CHANGED SINCE. The diff
--   against live is in the C673 note. `create or replace` keeps each function's grants.
-- VERIFY: supabase/verify/098_live_fixes.sql. ROLLBACK: re-apply the three live definitions.
-- ═══════════════════════════════════════════════════════════════════════════════
begin;

do $$
declare h record;
begin
  for h in
    select p.proname, md5(p.prosrc) as live, x.expected
    from (values ('accept_invite','f5c390427d7cc8a2e16bba52401727bf'),
                 ('guard_signed_period_lines','af0889a75d52f237ffe5304a5e031290'),
                 ('post_journal_entry','6b9da39333352f72977277496fb855b3')) as x(name, expected)
    join pg_proc p on p.proname = x.name
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  loop
    if h.live is distinct from h.expected then
      raise exception '098 NOT APPLIED - nothing was changed. The live % is not the text this file was written from.', h.proname;
    end if;
  end loop;
end $$;

CREATE OR REPLACE FUNCTION public.accept_invite(p_token uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_role := lower(coalesce(inv.role, 'viewer'));
  if v_role = 'member' then v_role := 'viewer'; end if;
  if v_role not in ('admin','accountant','viewer') then v_role := 'viewer'; end if;
  if not exists (select 1 from public.company_users
                 where company_id = inv.company_id and user_id = v_user) then
    insert into public.company_users (company_id, user_id, role, accepted_at)
    values (inv.company_id, v_user, v_role, now());
  end if;
  update public.company_invites set status = 'accepted' where id = inv.id;
  return inv.company_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.guard_signed_period_lines()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare e record;
begin
  if (TG_OP = 'UPDATE')
     and NEW.journal_entry_id is not distinct from OLD.journal_entry_id
     and NEW.account_id is not distinct from OLD.account_id
     and NEW.debit      is not distinct from OLD.debit
     and NEW.credit     is not distinct from OLD.credit then
    return NEW;
  end if;

  -- a line moved between entries: the entry it LEAVES is checked too
  if (TG_OP = 'UPDATE') and NEW.journal_entry_id is distinct from OLD.journal_entry_id then
    select company_id, entry_date, source into e
    from public.journal_entries where id = OLD.journal_entry_id;
    if found and coalesce(e.source,'') <> 'opening_balance'
       and public.period_is_signed(e.company_id, e.entry_date) then
      raise exception '%', public.signed_period_error(e.entry_date) using errcode = 'check_violation';
    end if;
  end if;

  select company_id, entry_date, source into e
  from public.journal_entries
  where id = coalesce(NEW.journal_entry_id, OLD.journal_entry_id);
  if not found then return coalesce(NEW, OLD); end if;

  if coalesce(e.source,'') <> 'opening_balance'
     and public.period_is_signed(e.company_id, e.entry_date) then
    raise exception '%', public.signed_period_error(e.entry_date) using errcode = 'check_violation';
  end if;
  return coalesce(NEW, OLD);
end $function$;

CREATE OR REPLACE FUNCTION public.post_journal_entry(p_company_id uuid, p_entry_date date, p_description text, p_source text, p_created_by uuid, p_lines jsonb, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_entry_id     uuid;
  v_total_debit  numeric := 0;
  v_total_credit numeric := 0;
  v_line         jsonb;
  v_result       jsonb;
begin
  if not public.is_company_writer(p_company_id) then
    raise exception 'not allowed to record entries for company %', p_company_id using errcode = '42501';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'journal entry must have at least one line';
  end if;

  select coalesce(sum((l->>'debit')::numeric), 0),
         coalesce(sum((l->>'credit')::numeric), 0)
    into v_total_debit, v_total_credit
    from jsonb_array_elements(p_lines) as l;

  if round(v_total_debit, 2) <> round(v_total_credit, 2) then
    raise exception 'journal entry not balanced: debits % <> credits %', v_total_debit, v_total_credit;
  end if;

  insert into public.journal_entries (
    company_id, entry_date, description, source, status, posted_at, created_by,
    ai_reasoning, ai_confidence, approval_status, payment_status, payment_method, due_date
  ) values (
    p_company_id, p_entry_date, p_description, coalesce(p_source, 'manual'), 'posted', now(), p_created_by,
    nullif(p_meta->>'ai_reasoning', ''),
    nullif(p_meta->>'ai_confidence', '')::numeric,
    nullif(p_meta->>'approval_status', ''),
    nullif(p_meta->>'payment_status', ''),
    nullif(p_meta->>'payment_method', ''),
    nullif(p_meta->>'due_date', '')::date
  )
  returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    if (v_line->>'account_id') is null then
      raise exception 'every line must have an account_id';
    end if;
    insert into public.journal_entry_lines (journal_entry_id, company_id, account_id, debit, credit, memo)
    values (
      v_entry_id, p_company_id,
      (v_line->>'account_id')::uuid,
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      v_line->>'memo'
    );
  end loop;

  select jsonb_build_object(
    'id', v_entry_id,
    'entry', to_jsonb(je.*),
    'lines', coalesce(
      (select jsonb_agg(to_jsonb(jel.*)) from public.journal_entry_lines jel where jel.journal_entry_id = v_entry_id),
      '[]'::jsonb)
  ) into v_result
  from public.journal_entries je
  where je.id = v_entry_id;

  return v_result;
exception
  when others then
    raise;
end;
$function$;

commit;
