-- =====================================================================
-- 010_post_journal_entry.sql
-- Atomic journal-entry posting. Inserts the header + all lines inside ONE
-- transaction (a plpgsql function is atomic by default — if any statement
-- raises, every change rolls back), validates that debits = credits, and
-- returns the entry with its lines. Replaces the app's two separate inserts.
--
-- VERIFY before running: journal_entries has columns
--   (company_id, entry_date, description, source, status, posted_at,
--    created_by, ai_reasoning, ai_confidence, approval_status,
--    payment_status, payment_method, due_date)
-- and journal_entry_lines has (journal_entry_id, company_id, account_id,
--   debit, credit, memo). Drop any column from the INSERT below that your
-- schema does not have.
-- =====================================================================

create or replace function public.post_journal_entry(
  p_company_id  uuid,
  p_entry_date  date,
  p_description text,
  p_source      text,
  p_created_by  uuid,
  p_lines       jsonb,            -- [{ "account_id": uuid, "debit": num, "credit": num, "memo": text }]
  p_meta        jsonb default '{}'::jsonb  -- optional: ai_reasoning, ai_confidence, approval_status, payment_status, payment_method, due_date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_entry_id     uuid;
  v_total_debit  numeric := 0;
  v_total_credit numeric := 0;
  v_line         jsonb;
  v_result       jsonb;
begin
  -- 1. Authorization
  if not public.is_company_member(p_company_id) then
    raise exception 'not a member of company %', p_company_id using errcode = '42501';
  end if;

  -- 2. Must have lines
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'journal entry must have at least one line';
  end if;

  -- 3. Must balance (debits = credits, to the cent)
  select coalesce(sum((l->>'debit')::numeric), 0),
         coalesce(sum((l->>'credit')::numeric), 0)
    into v_total_debit, v_total_credit
    from jsonb_array_elements(p_lines) as l;

  if round(v_total_debit, 2) <> round(v_total_credit, 2) then
    raise exception 'journal entry not balanced: debits % <> credits %', v_total_debit, v_total_credit;
  end if;

  -- 4. Insert header
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

  -- 5. Insert lines
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

  -- 6. Return the entry + its lines
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
    -- Any failure above rolls back the header AND the lines together.
    raise;
end;
$fn$;

revoke all on function public.post_journal_entry(uuid, date, text, text, uuid, jsonb, jsonb) from public;
grant execute on function public.post_journal_entry(uuid, date, text, text, uuid, jsonb, jsonb) to authenticated;
