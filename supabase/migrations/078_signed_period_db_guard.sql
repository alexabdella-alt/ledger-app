-- 078 — THE DATABASE REFUSES TO CHANGE A SIGNED-OFF MONTH.
--
-- ── WHY ───────────────────────────────────────────────────────────────────────
-- The app blocks writes into an attested period (`signedPeriodForDate`, checked at every
-- booking, recode, payment and delete path). **The database does not.** That contradicts
-- this project's own rule, stated in §3 about tenancy and equally true here: *never rely on
-- a client-side check for something that matters; the database is the boundary.* A
-- sign-off is the CPA putting their name to a month's numbers. Anything that can change
-- those numbers afterwards without reopening the month makes the signature worth less than
-- it looks.
--
-- ★★ THIS TRIGGER IS DELIBERATELY NARROWER THAN "BLOCK EVERY WRITE", AND THE REASON IS A
-- REAL FLOW IT WOULD OTHERWISE BREAK. Marking an old bill as paid is legitimate: the
-- PAYMENT is a new entry dated today, and the client checks the pay date, not the bill's.
-- But it also stamps `payment_status` on the original bill — an UPDATE to a row inside the
-- signed month. A blanket block would refuse that, and the first symptom would be a CPA
-- unable to record a payment against last quarter's invoice.
--
-- So the guard protects what a signature is ABOUT:
--   · **existence**  — no new entry may appear in a signed month, and none may vanish
--                      (`deleted_at`) or be hard-deleted from it;
--   · **the numbers** — no line may be added, changed or removed;
--   · **the date**    — an entry may not be moved INTO or OUT OF a signed month.
-- Metadata that carries no amount — `payment_status`, `import_metadata`, `ai_reasoning` —
-- stays writable, because none of it changes what the CPA attested to.
--
-- ★ `opening_balance` IS EXEMPT, matching `signedPeriodForDate` exactly. The opening entry
-- is dated at the cutoff, which may sit inside an attested month, and the deliberate
-- "redo opening setup" path reverses and replaces it. The client already exempts it; a
-- database that did not would make the two disagree, which is worse than either rule.
--
-- ▶ THE ESCAPE HATCH IS REOPENING THE MONTH, which is an explicit, audited act. That is
-- the point: the correction becomes visible instead of quiet.
--
-- Idempotent. No backfill, no validation of existing rows — triggers apply to future
-- writes only, so there is nothing to adopt.

begin;

-- ── Is this date inside a live sign-off? ──────────────────────────────────────
-- SECURITY DEFINER on purpose: `period_signoffs` has RLS, and a guard whose input can be
-- made invisible by a policy is a guard that can be defeated by not being able to see the
-- thing it checks. It must answer the same way for every caller.
create or replace function public.period_is_signed(p_company uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.period_signoffs s
    where s.company_id = p_company
      and s.revoked_at is null
      and s.period = to_char(p_date, 'YYYY-MM')
  );
$$;

revoke all on function public.period_is_signed(uuid, date) from public;
grant execute on function public.period_is_signed(uuid, date) to authenticated, service_role;

-- ── The message a person might actually see ───────────────────────────────────
create or replace function public.signed_period_error(p_date date)
returns text
language sql
immutable
as $$
  select to_char(p_date, 'FMMonth YYYY')
      || ' has been signed off by your accountant, so its figures cannot be changed. '
      || 'Reopen that month first if a correction is genuinely needed.';
$$;

-- ── journal_entries: existence and date ───────────────────────────────────────
create or replace function public.guard_signed_period_entries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (TG_OP = 'INSERT') then
    if coalesce(NEW.source, '') <> 'opening_balance'
       and public.period_is_signed(NEW.company_id, NEW.entry_date) then
      raise exception '%', public.signed_period_error(NEW.entry_date)
        using errcode = 'check_violation';
    end if;
    return NEW;
  end if;

  if (TG_OP = 'DELETE') then
    if coalesce(OLD.source, '') <> 'opening_balance'
       and public.period_is_signed(OLD.company_id, OLD.entry_date) then
      raise exception '%', public.signed_period_error(OLD.entry_date)
        using errcode = 'check_violation';
    end if;
    return OLD;
  end if;

  -- UPDATE. Only the three things a signature is about. `payment_status`,
  -- `import_metadata`, `ai_*` and friends are untouched by this guard on purpose.
  if coalesce(OLD.source, '') <> 'opening_balance'
     and (OLD.entry_date  is distinct from NEW.entry_date
       or OLD.status      is distinct from NEW.status
       or OLD.deleted_at  is distinct from NEW.deleted_at) then
    -- Moving OUT of a signed month is blocked by the OLD date; moving INTO one by the NEW.
    if public.period_is_signed(OLD.company_id, OLD.entry_date) then
      raise exception '%', public.signed_period_error(OLD.entry_date)
        using errcode = 'check_violation';
    end if;
    if public.period_is_signed(NEW.company_id, NEW.entry_date) then
      raise exception '%', public.signed_period_error(NEW.entry_date)
        using errcode = 'check_violation';
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists guard_signed_period_entries on public.journal_entries;
create trigger guard_signed_period_entries
  before insert or update or delete on public.journal_entries
  for each row execute function public.guard_signed_period_entries();

-- ── journal_entry_lines: the numbers themselves ───────────────────────────────
create or replace function public.guard_signed_period_lines()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare e record;
begin
  select company_id, entry_date, source into e
  from public.journal_entries
  where id = coalesce(NEW.journal_entry_id, OLD.journal_entry_id);

  -- ★ NO PARENT ⇒ THIS IS A CASCADE from the entry's own deletion, which the entries
  -- trigger has already ruled on. Blocking here too would make a legitimate delete of an
  -- OPEN entry fail on its own children.
  if not found then return coalesce(NEW, OLD); end if;

  if coalesce(e.source, '') <> 'opening_balance'
     and public.period_is_signed(e.company_id, e.entry_date) then
    raise exception '%', public.signed_period_error(e.entry_date)
      using errcode = 'check_violation';
  end if;
  return coalesce(NEW, OLD);
end $$;

drop trigger if exists guard_signed_period_lines on public.journal_entry_lines;
create trigger guard_signed_period_lines
  before insert or update or delete on public.journal_entry_lines
  for each row execute function public.guard_signed_period_lines();

commit;
