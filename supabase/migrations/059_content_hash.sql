-- =====================================================================
-- 059_content_hash.sql
-- C193 — content-hash dedup for documents + bank statements, and statement
-- SUPERSEDE (§11 O84 finding (d)).
--
-- Live evidence: the doc library holds 3× March + 3× Feb copies of the same
-- statement file, and Review shows 7 ZOMBIE exception cards belonging to older
-- statement rows whose lines were already resolved on a newer upload. Line-level
-- idempotency held across all uploads (verified live 7×) — this fixes the
-- statement/document layer ABOVE it:
--   • documents  — identical bytes per company link to the EXISTING row (unique index).
--   • bank_statements — a re-upload still gets its own fresh run record, but every
--     PRIOR same-content row for that account is marked 'superseded' + pointed at
--     the new row, so the read layer can hide its stale exceptions.
--
-- NOTHING is deleted (no rows, no storage objects). Dedup is scoped per company and,
-- for statements, per bank account — the same file uploaded to the WRONG account must
-- stay visible as its own problem, never silently merged.
--
-- Additive + idempotent. Manual apply (CLAUDE.md §6 — do NOT db push). Apply 058 first.
-- =====================================================================
begin;

-- ── 1. documents: content hash, unique per company (the dedup key) ────────────
alter table public.documents
  add column if not exists content_hash text;

-- PARTIAL unique: pre-C193 rows (and any row we couldn't hash) have NULL and are exempt,
-- so this can be added to a populated table. It is also the RACE BACKSTOP — two concurrent
-- uploads of identical bytes collide here (23505) and the loser re-selects the winner's row.
create unique index if not exists documents_company_content_hash_uidx
  on public.documents (company_id, content_hash)
  where content_hash is not null;

-- ── 2. bank_statements: content hash (NON-unique — a re-upload keeps its own run record) ──
alter table public.bank_statements
  add column if not exists content_hash text;

create index if not exists bank_statements_company_account_hash_idx
  on public.bank_statements (company_id, bank_account_id, content_hash);

-- ── 3. bank_statements: supersede linkage + the new status ────────────────────
alter table public.bank_statements
  add column if not exists superseded_by uuid references public.bank_statements(id);

-- Re-assert the status CHECK with 'superseded' added (drop-then-add = idempotent).
alter table public.bank_statements
  drop constraint if exists bank_statements_status_check;
alter table public.bank_statements
  add constraint bank_statements_status_check
  check (status in ('parsed','processing','complete','attention','superseded'));

-- ── 4. ONE-TIME BACKFILL: retire the existing duplicate statement rows ────────
-- Pre-C193 rows have content_hash NULL, so they cannot be grouped by hash. Group them
-- instead by (company_id, bank_account_id, period_start, period_end, source_filename) —
-- the same file re-uploaded to the same account for the same period. Within each group
-- the NEWEST row (created_at desc, id desc as a deterministic tie-break) is kept LIVE;
-- every older row is marked 'superseded' and pointed at that newest row. This is what
-- clears the 7 live zombie exception cards.
-- Deterministic, idempotent (re-running selects the same newest row), and destroys nothing.
with ranked as (
  select
    id,
    first_value(id) over w  as newest_id,
    row_number()    over w  as rn
  from public.bank_statements
  window w as (
    partition by company_id, bank_account_id, period_start, period_end, source_filename
    order by created_at desc, id desc
  )
)
update public.bank_statements bs
set status = 'superseded',
    superseded_by = r.newest_id
from ranked r
where bs.id = r.id
  and r.rn > 1                      -- everything except the newest in each group
  and bs.status <> 'superseded';    -- already-retired rows are left alone

commit;
