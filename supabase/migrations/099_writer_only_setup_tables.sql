-- ═══════════════════════════════════════════════════════════════════════════════
-- 099 — A VIEW-ONLY TEAMMATE CAN READ THE BOOKS' SETUP, NOT CHANGE IT (review item S4, the rest;
-- S5's anomaly-deletion route). Read live 2026-11-13 (pg_policies).
--
-- `098` stopped a view-only member recording entries (post_journal_entry). The setup tables kept
-- `is_company_member` on every write, so the same viewer could still, through the API, add or
-- change categories, contacts, vendor rules (which auto-code future entries), bank accounts,
-- documents and the upload log. Each now needs `is_company_writer` (owner / admin / accountant,
-- or the platform admin) — the rule the journal lines already use.
--
-- ★ Checked first: nothing the app does in the background for a viewer writes these tables —
--   uploads are refused to a viewer up front (C681) and bookings by `098`; the anomaly detector
--   (any member) writes `anomalies`, which keeps its member rule for insert/update.
-- ★ ANOMALIES: deleting a flagged anomaly needs the REVIEWER rule (`is_company_reviewer`, the same
--   one that already gates dismissing) — any member could delete the row instead of dismissing it.
--
-- One policy per table per command before and after (the §11 invariant); names unchanged.
-- Idempotent. VERIFY: supabase/verify/099_writer_only.sql. ROLLBACK: recreate each with
-- `is_company_member(company_id)` (and `public` role on document_intake).
-- ═══════════════════════════════════════════════════════════════════════════════
begin;

do $$
declare t text;
begin
  foreach t in array array['accounts','vendor_rules','bank_accounts','documents','document_intake'] loop
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_company_writer(company_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_company_writer(company_id)) with check (public.is_company_writer(company_id))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_company_writer(company_id))', t || '_delete', t);
  end loop;
end $$;

-- contacts has insert/update only (no delete policy live — deletes were never allowed); keep it that way.
drop policy if exists contacts_insert on public.contacts;
drop policy if exists contacts_update on public.contacts;
create policy contacts_insert on public.contacts for insert to authenticated with check (public.is_company_writer(company_id));
create policy contacts_update on public.contacts for update to authenticated using (public.is_company_writer(company_id)) with check (public.is_company_writer(company_id));

-- anomalies: insert/update unchanged (the detector runs for any member; dismissing already needs a reviewer).
drop policy if exists anomalies_delete on public.anomalies;
create policy anomalies_delete on public.anomalies for delete to authenticated using (public.is_company_reviewer(company_id));

commit;
