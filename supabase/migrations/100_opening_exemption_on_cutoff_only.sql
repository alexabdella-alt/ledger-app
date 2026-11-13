-- ═══════════════════════════════════════════════════════════════════════════════
-- 100 — A SIGNED-OFF MONTH CANNOT BE CHANGED BY LABELLING AN ENTRY "OPENING BALANCE"
-- (review item S5a). Read live 2026-11-13.
--
-- 078's guards exempt every entry whose source is 'opening_balance' — deliberately: the opening
-- entry is dated at the company's cutoff, which may sit inside an attested month, and "redo
-- opening setup" replaces it. But `post_journal_entry` accepts any `p_source`, so anyone able
-- to record entries could date an "opening balance" anywhere in a signed month and change it.
-- The exemption now holds only for what the app actually writes: an opening entry dated ON the
-- company's cutoff (or a legacy company with no cutoff). Confirmed live first: all 6 opening
-- entries are on their cutoff; the 7th belongs to the company with no cutoff.
-- On UPDATE the exemption needs BOTH the old and the new row to qualify, so the opening entry
-- cannot be moved off its cutoff into a signed month either.
--
-- ★ §6: both guard bodies are the live text with only the exemption test changed (diff in the
--   C684 note); the first block refuses — changing nothing — if either has changed since.
-- VERIFY: supabase/verify/100_opening_exemption.sql. ROLLBACK: re-apply the two live bodies,
-- drop function public.exempt_opening_entry(uuid, text, date).
-- ═══════════════════════════════════════════════════════════════════════════════
begin;

do $$
declare h record;
begin
  for h in
    select p.proname, md5(p.prosrc) as live, x.expected
    from (values ('guard_signed_period_entries','5febcd2652cfd1be88b80f3b502ce38d'),
                 ('guard_signed_period_lines','bfbe26bbda22ab57f50677b4c7c81866')) as x(name, expected)
    join pg_proc p on p.proname = x.name
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  loop
    if h.live is distinct from h.expected then
      raise exception '100 NOT APPLIED - nothing was changed. The live % is not the text this file was written from.', h.proname;
    end if;
  end loop;
end $$;

-- The opening entry the app writes: source 'opening_balance', dated on the company's cutoff
-- (or the company has no cutoff — legacy).
create or replace function public.exempt_opening_entry(p_company uuid, p_source text, p_date date)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(p_source, '') = 'opening_balance'
     and coalesce((select c.cutoff_date is null or c.cutoff_date = p_date from public.companies c where c.id = p_company), true);
$$;
revoke all on function public.exempt_opening_entry(uuid, text, date) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_signed_period_entries()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (TG_OP = 'INSERT') then
    if not public.exempt_opening_entry(NEW.company_id, NEW.source, NEW.entry_date)
       and public.period_is_signed(NEW.company_id, NEW.entry_date) then
      raise exception '%', public.signed_period_error(NEW.entry_date) using errcode = 'check_violation';
    end if;
    return NEW;
  end if;
  if (TG_OP = 'DELETE') then
    if not public.exempt_opening_entry(OLD.company_id, OLD.source, OLD.entry_date)
       and public.period_is_signed(OLD.company_id, OLD.entry_date) then
      raise exception '%', public.signed_period_error(OLD.entry_date) using errcode = 'check_violation';
    end if;
    return OLD;
  end if;
  if not (public.exempt_opening_entry(OLD.company_id, OLD.source, OLD.entry_date)
           and public.exempt_opening_entry(NEW.company_id, NEW.source, NEW.entry_date))
     and (OLD.entry_date is distinct from NEW.entry_date
       or OLD.status     is distinct from NEW.status
       or OLD.deleted_at is distinct from NEW.deleted_at) then
    if public.period_is_signed(OLD.company_id, OLD.entry_date) then
      raise exception '%', public.signed_period_error(OLD.entry_date) using errcode = 'check_violation';
    end if;
    if public.period_is_signed(NEW.company_id, NEW.entry_date) then
      raise exception '%', public.signed_period_error(NEW.entry_date) using errcode = 'check_violation';
    end if;
  end if;
  return NEW;
end $function$;

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
    if found and not public.exempt_opening_entry(e.company_id, e.source, e.entry_date)
       and public.period_is_signed(e.company_id, e.entry_date) then
      raise exception '%', public.signed_period_error(e.entry_date) using errcode = 'check_violation';
    end if;
  end if;

  select company_id, entry_date, source into e
  from public.journal_entries
  where id = coalesce(NEW.journal_entry_id, OLD.journal_entry_id);
  if not found then return coalesce(NEW, OLD); end if;

  if not public.exempt_opening_entry(e.company_id, e.source, e.entry_date)
     and public.period_is_signed(e.company_id, e.entry_date) then
    raise exception '%', public.signed_period_error(e.entry_date) using errcode = 'check_violation';
  end if;
  return coalesce(NEW, OLD);
end $function$;

commit;
