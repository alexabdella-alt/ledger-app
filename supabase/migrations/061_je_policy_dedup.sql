-- =====================================================================
-- 061_je_policy_dedup.sql
-- C199 · RLS HARDENING — ONE POLICY GENERATION GOVERNS THE LEDGER.
-- RLS audit finding, 2026-08-08 (live pg_policies census).
--
-- ── THE TRAP: OVERLAPPING PERMISSIVE POLICIES OR-COMBINE ──────────────
-- Postgres evaluates multiple PERMISSIVE policies for the same command
-- with OR. A row is visible/writable if ANY of them allows it. So adding
-- a policy can only ever LOOSEN a table, never tighten it — and the
-- LOOSEST policy wins. A strict policy sitting beside a broad one is not
-- a restriction; it is a comment.
--
-- ── THE FINDING ───────────────────────────────────────────────────────
-- Six ledger tables carry TWO generations of policy:
--   • the ORIGINAL short-named set (je_*, jel_*, ar_*, arl_*, recon_*,
--     recurring_*) — membership AND role IN (owner, admin, accountant),
--     with extra guards on some updates;
--   • the LATER <table>_* set from migration 001 — bare
--     is_company_member(company_id) on all four commands.
-- Because they OR-combine, every role restriction and every extra guard
-- in the first generation has been a DEAD LETTER since 001 was applied.
-- A 'viewer' has had full write access to the general ledger.
--
-- This migration removes the broad generation so the strict one governs.
--
-- ── RULE APPLIED: ONLY DROP WHERE A STRICTER COUNTERPART EXISTS ───────
-- A broad policy is dropped ONLY when a stricter policy for the SAME
-- command remains. Dropping a policy with no counterpart is not a dedup,
-- it is a new denial. So journal_entry_lines_delete, ar_invoices_delete
-- and reconciliations_delete are KEPT — the first generation never had a
-- DELETE for those tables.
--
-- ── SELECT: KEEP THE is_company_member ONE (this is deliberate) ───────
-- The two generations' SELECTs do NOT agree, though it looks like they
-- do. auth_company_ids() is plain membership; is_company_member() is
-- `is_platform_admin() OR membership` (§3 Option A, re-asserted in 036).
-- The old SELECT is therefore a STRICT SUBSET, and current effective read
-- access is the union — i.e. exactly is_company_member. Keeping the
-- <table>_select policy preserves read behaviour bit for bit; keeping the
-- old one instead would silently break Support Mode. Read access is
-- unchanged by this migration.
--
-- ── PLATFORM-ADMIN BYPASS IS PRESERVED ON WRITES (deviation, flagged) ─
-- The first generation predates Support Mode and has no platform-admin
-- bypass, so dropping the broad write policies as-is would revoke
-- platform-admin INSERT/UPDATE on the whole ledger — a documented,
-- audit-logged capability (§3), and a live foot-gun: per §11 the
-- operator's own Franklin Ave role was flipped to 'viewer' during O83
-- role-gating tests and no entry records it being flipped back. The
-- recreated policies therefore use `is_company_writer()`, which is the
-- role gate OR platform admin — the same shape migration 051 already
-- established for is_company_reviewer(). The goal was to make the ROLE
-- GATE live, not to revoke Support Mode.
--
-- ── WITH CHECK ADDED (hole the old generation had) ────────────────────
-- The first generation's UPDATE policies have USING but NO WITH CHECK,
-- so the post-update row was never re-validated — a member could move a
-- row to ANOTHER company_id. The broad 001 policies did carry WITH CHECK,
-- so today that hole is masked by the very policies being dropped here.
-- Every recreated UPDATE below has an explicit WITH CHECK.
--
-- ── DEAD PREDICATE REMOVED: jel_update's parent-status clause ─────────
-- jel_update additionally required the parent journal entry's
-- status = 'draft'. post_journal_entry (010) writes 'posted' and nothing
-- in the app ever writes 'draft' to journal_entries, so that clause
-- matches ZERO rows — jel_update is currently unsatisfiable, and line
-- updates work only because the broad policy allows them. Dropping the
-- broad policy while keeping the dead clause would BREAK live paths
-- (recode: App.jsx:1272 `.update({account_id})`; project retag:
-- App.jsx:2545 `.update({project})`). The clause is therefore dropped and
-- the role gate kept — the restriction that was actually intended.
-- ar_invoice_lines is NOT the same case: ar_invoices genuinely uses
-- 'draft' (its CHECK allows draft/sent/partial/paid/void and the app
-- writes it), so arl_*'s parent-status guard is live-meaningful and is
-- kept verbatim.
--
-- ── je_update's `status <> 'void'` is VACUOUS but harmless, so kept ───
-- Voiding is implemented as a GAAP reversing entry plus soft delete
-- (deleted_at), never a status flip — no app path writes
-- journal_entries.status = 'void', so the clause is always true today. It
-- blocks nothing (undo-of-void updates deleted_at on a 'posted' row and
-- is unaffected) and would engage correctly if a void status is ever
-- introduced. Kept as written.
--
-- Not included: unknown_documents, audit_log and subscriptions carry the
-- same duplication and are deliberately left for a separate reviewed
-- change — see the session report.
--
-- Idempotent (drop-if-exists + create). Requires 000/001 and 036.
-- =====================================================================
begin;

-- ── The write gate: role, OR platform admin (mirrors 051's reviewer) ──
create or replace function public.is_company_writer(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_platform_admin()
      or exists (select 1 from public.company_users cu
                 where cu.company_id = cid
                   and cu.user_id = auth.uid()
                   and cu.accepted_at is not null
                   and cu.role in ('owner','admin','accountant'));
$$;

revoke all on function public.is_company_writer(uuid) from public;
grant execute on function public.is_company_writer(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- journal_entries — keep journal_entries_select. No DELETE policy exists
-- on this table in either generation (hard deletes denied; soft delete is
-- the model, §7) — that is left exactly as it is.
-- ─────────────────────────────────────────────────────────────────────
drop policy if exists je_select               on public.journal_entries;   -- subset dup of journal_entries_select
drop policy if exists journal_entries_insert  on public.journal_entries;   -- broad; je_insert governs
drop policy if exists journal_entries_update  on public.journal_entries;   -- broad; je_update governs

drop policy if exists je_insert on public.journal_entries;
create policy je_insert on public.journal_entries
  for insert to authenticated
  with check (public.is_company_writer(company_id));

drop policy if exists je_update on public.journal_entries;
create policy je_update on public.journal_entries
  for update to authenticated
  using       (public.is_company_writer(company_id) and status <> 'void')
  with check  (public.is_company_writer(company_id));


-- ─────────────────────────────────────────────────────────────────────
-- journal_entry_lines — dead parent-status='draft' clause dropped (see
-- header). journal_entry_lines_delete KEPT: no first-generation DELETE.
-- ─────────────────────────────────────────────────────────────────────
drop policy if exists jel_select                    on public.journal_entry_lines;
drop policy if exists journal_entry_lines_insert    on public.journal_entry_lines;
drop policy if exists journal_entry_lines_update    on public.journal_entry_lines;

drop policy if exists jel_insert on public.journal_entry_lines;
create policy jel_insert on public.journal_entry_lines
  for insert to authenticated
  with check (public.is_company_writer(company_id));

drop policy if exists jel_update on public.journal_entry_lines;
create policy jel_update on public.journal_entry_lines
  for update to authenticated
  using      (public.is_company_writer(company_id))
  with check (public.is_company_writer(company_id));


-- ─────────────────────────────────────────────────────────────────────
-- ar_invoices — ar_invoices_delete KEPT: no first-generation DELETE.
-- ─────────────────────────────────────────────────────────────────────
drop policy if exists ar_select           on public.ar_invoices;
drop policy if exists ar_invoices_insert  on public.ar_invoices;
drop policy if exists ar_invoices_update  on public.ar_invoices;

drop policy if exists ar_insert on public.ar_invoices;
create policy ar_insert on public.ar_invoices
  for insert to authenticated
  with check (public.is_company_writer(company_id));

drop policy if exists ar_update on public.ar_invoices;
create policy ar_update on public.ar_invoices
  for update to authenticated
  using      (public.is_company_writer(company_id))
  with check (public.is_company_writer(company_id));


-- ─────────────────────────────────────────────────────────────────────
-- ar_invoice_lines — the parent-status='draft' guard is REAL here and is
-- kept verbatim: lines are editable only while the invoice is a draft.
-- (The client never writes this table directly, so no live path changes.)
-- ─────────────────────────────────────────────────────────────────────
drop policy if exists arl_select                 on public.ar_invoice_lines;
drop policy if exists ar_invoice_lines_insert    on public.ar_invoice_lines;
drop policy if exists ar_invoice_lines_update    on public.ar_invoice_lines;
drop policy if exists ar_invoice_lines_delete    on public.ar_invoice_lines;

drop policy if exists arl_insert on public.ar_invoice_lines;
create policy arl_insert on public.ar_invoice_lines
  for insert to authenticated
  with check (public.is_company_writer(company_id));

drop policy if exists arl_update on public.ar_invoice_lines;
create policy arl_update on public.ar_invoice_lines
  for update to authenticated
  using (
    public.is_company_writer(company_id)
    and (select i.status from public.ar_invoices i
         where i.id = ar_invoice_lines.ar_invoice_id) = 'draft'
  )
  with check (public.is_company_writer(company_id));

drop policy if exists arl_delete on public.ar_invoice_lines;
create policy arl_delete on public.ar_invoice_lines
  for delete to authenticated
  using (
    public.is_company_writer(company_id)
    and (select i.status from public.ar_invoices i
         where i.id = ar_invoice_lines.ar_invoice_id) = 'draft'
  );


-- ─────────────────────────────────────────────────────────────────────
-- reconciliations — reconciliations_delete KEPT: no first-gen DELETE.
-- ─────────────────────────────────────────────────────────────────────
drop policy if exists recon_select             on public.reconciliations;
drop policy if exists reconciliations_insert   on public.reconciliations;
drop policy if exists reconciliations_update   on public.reconciliations;

drop policy if exists recon_insert on public.reconciliations;
create policy recon_insert on public.reconciliations
  for insert to authenticated
  with check (public.is_company_writer(company_id));

drop policy if exists recon_update on public.reconciliations;
create policy recon_update on public.reconciliations
  for update to authenticated
  using      (public.is_company_writer(company_id))
  with check (public.is_company_writer(company_id));


-- ─────────────────────────────────────────────────────────────────────
-- recurring_transactions — DELETE is owner/admin only in the first
-- generation (stricter than the write gate); that is preserved.
-- ─────────────────────────────────────────────────────────────────────
drop policy if exists recurring_select                   on public.recurring_transactions;
drop policy if exists recurring_transactions_insert      on public.recurring_transactions;
drop policy if exists recurring_transactions_update      on public.recurring_transactions;
drop policy if exists recurring_transactions_delete      on public.recurring_transactions;

drop policy if exists recurring_insert on public.recurring_transactions;
create policy recurring_insert on public.recurring_transactions
  for insert to authenticated
  with check (public.is_company_writer(company_id));

drop policy if exists recurring_update on public.recurring_transactions;
create policy recurring_update on public.recurring_transactions
  for update to authenticated
  using      (public.is_company_writer(company_id))
  with check (public.is_company_writer(company_id));

drop policy if exists recurring_delete on public.recurring_transactions;
create policy recurring_delete on public.recurring_transactions
  for delete to authenticated
  using (
    public.is_platform_admin()
    or exists (select 1 from public.company_users cu
               where cu.company_id = recurring_transactions.company_id
                 and cu.user_id = auth.uid()
                 and cu.accepted_at is not null
                 and cu.role in ('owner','admin'))
  );

commit;
