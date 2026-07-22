-- =====================================================================
-- 055_reconciliation_verified_balance.sql  (O83 follow-up 2)
--
-- Distinguish a VERIFIED statement ending balance from an unverified default.
-- completeMatch now requires a real ending balance to finish; a genuine $0 (empty/
-- closed account) requires an explicit confirmation. Both set this flag TRUE. The
-- hardened sign-off gate (reconciliationCoversPeriod) counts a $0 reconciliation ONLY
-- when it's verified — so the old unverified-$0 phantoms (Franklin) still don't count,
-- but a legitimately-empty account can be reconciled and satisfy the gate.
--
-- Existing rows default FALSE: legacy REAL reconciliations still count via their
-- non-zero statement_balance (the gate is `non-zero balance OR verified`); only
-- unverified-$0 records are excluded.
--
-- Apply after 005 (reconciliations). Idempotent; safe to re-apply.
-- =====================================================================
begin;

alter table public.reconciliations
  add column if not exists statement_balance_verified boolean not null default false;

commit;
