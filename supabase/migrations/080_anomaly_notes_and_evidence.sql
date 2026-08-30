-- 080 — ANOMALY COMMENTS, DISMISSAL EVIDENCE, AND THE REVIEWER GATE THAT WAS UI-ONLY.
--
-- ── (1) COMMENTS — the owner can inform a judgement they may not make ─────────
-- Dismissing an anomaly is permanently reviewer-only, deliberately: clearing your own flag
-- is self-attestation one anomaly at a time. But the owner is frequently the ONLY person
-- who knows why a charge is fine, and the card gave them no way to say so. A comment is
-- NOT a clear action — it never touches `status` — so it adds context without touching the
-- separation of duties.
--
-- ── (2) EVIDENCE — a reason says what someone concluded; a document shows why ─
-- `evidence_doc_ids` mirrors `entity_refs`: a jsonb array of `documents.id`. **Optional by
-- design.** Legitimate dismissals often have no support, and requiring one would produce
-- attachments chosen for being nearest, which is worse than none because it LOOKS like
-- support. The reason stays required; the app suggests evidence above a threshold.
--
-- ── (3) ★★ AND THE ONE THAT IS NOT A FEATURE: THE REVIEWER GATE WAS THE APP'S ALONE ──
-- `056` says so in its own header — *"UI enforces reviewer-only dismissal + required
-- reason; the DB boundary is membership."* So any member could dismiss an anomaly through
-- the API, and dismissal is the act that (a) clears a flag off the review queue and (b)
-- feeds `priorDismissalFor`, which quietly downgrades later flags for the same vendor and
-- amount. **A viewer could therefore lower the system's guard against a repeat of exactly
-- the thing they cleared.** Same class as `061` (role gates that were a dead letter) and
-- `078` (the signed-period rule the database did not know about), and §3's rule: the app is
-- never the thing standing guard.
--
-- ★ THE POLICY DISCRIMINATES BY THE RESULTING ROW, NOT BY THE TABLE — the `079` lesson,
-- applied on purpose this time rather than after breaking something. Anomalies are also
-- updated by auto-resolve, by sign-off expiry, by reopen-on-revoke and by `last_seen_at`
-- bumps, and **all of those run as whoever is logged in — including an OWNER, who is NOT a
-- reviewer** (`is_company_reviewer` = admin or accountant, matching `canAttestPeriod`
-- exactly). A blanket reviewer requirement on UPDATE would have switched off automatic
-- anomaly housekeeping for every owner-run company. Only a row that ENDS UP dismissed
-- needs a reviewer.
--
-- Idempotent.

begin;

-- ── (2) evidence ─────────────────────────────────────────────────────────────
alter table public.anomalies add column if not exists evidence_doc_ids jsonb not null default '[]'::jsonb;

-- ── (1) comments ─────────────────────────────────────────────────────────────
create table if not exists public.anomaly_comments (
  id          uuid        default uuid_generate_v4() primary key,
  company_id  uuid        not null references public.companies(id) on delete cascade,
  anomaly_id  uuid        not null references public.anomalies(id) on delete cascade,
  body        text        not null check (length(btrim(body)) > 0 and length(body) <= 2000),
  author_id   uuid,
  author_name text,                                  -- denormalised so a thread reads after a user leaves
  created_at  timestamptz not null default now()
);

create index if not exists anomaly_comments_anomaly_idx on public.anomaly_comments (anomaly_id, created_at);
create index if not exists anomaly_comments_company_idx on public.anomaly_comments (company_id);

alter table public.anomaly_comments enable row level security;

-- Membership to read and to add. No UPDATE policy and no DELETE policy AT ALL, on purpose:
-- a comment is a record of what someone said at a moment, and one that can be edited or
-- removed afterwards is not evidence of anything. Same reasoning as `072`'s shadow rows.
drop policy if exists anomaly_comments_select on public.anomaly_comments;
create policy anomaly_comments_select on public.anomaly_comments
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists anomaly_comments_insert on public.anomaly_comments;
create policy anomaly_comments_insert on public.anomaly_comments
  for insert to authenticated
  with check (public.is_company_member(company_id) and author_id = auth.uid());

-- ── (3) the reviewer gate, now in the database ───────────────────────────────
drop policy if exists anomalies_update on public.anomalies;
create policy anomalies_update on public.anomalies
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (
    public.is_company_member(company_id)
    and (
      status is distinct from 'dismissed'
      or (
        public.is_company_reviewer(company_id)
        -- The required reason becomes a database rule too. It was app-enforced, and a
        -- dismissal with no reason is the thing the whole feature exists to prevent.
        and dismissed_reason is not null
        and length(btrim(dismissed_reason)) > 0
      )
    )
  );

commit;


-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFY — ONE STANDALONE STATEMENT PER CHECK. Run them ONE AT A TIME (§6): the editor
-- shows only the LAST statement's result, so pasting the block hides every verdict but one.
--
-- ▶ (c) and (d) report through `raise exception`, which Supabase renders RED under "Failed
-- to run sql query". `P0001` means a function raised it deliberately — nothing went wrong.
-- READ THE MESSAGE; it is the result.
-- ═══════════════════════════════════════════════════════════════════════════════

-- VERIFY (a) — the column and the table exist, with the right shape.
--
-- select
--   (select count(*) from information_schema.columns
--     where table_schema='public' and table_name='anomalies' and column_name='evidence_doc_ids') as evidence_col,
--   (select count(*) from information_schema.columns
--     where table_schema='public' and table_name='anomaly_comments') as comment_cols,
--   case when (select count(*) from information_schema.columns
--                where table_schema='public' and table_name='anomalies' and column_name='evidence_doc_ids') = 1
--         and (select count(*) from information_schema.columns
--                where table_schema='public' and table_name='anomaly_comments') = 7
--        then 'PASS - evidence column present, comments table has all 7 columns'
--        else 'FAIL - see the counts'
--   end as verdict;


-- VERIFY (b) — comments are append-only: RLS on, and NO update/delete policy exists.
--
-- select
--   (select relrowsecurity from pg_class where relname='anomaly_comments') as rls_on,
--   count(*) filter (where cmd = 'SELECT') as sel,
--   count(*) filter (where cmd = 'INSERT') as ins,
--   count(*) filter (where cmd in ('UPDATE','DELETE','ALL')) as mutating,
--   case when (select relrowsecurity from pg_class where relname='anomaly_comments')
--         and count(*) filter (where cmd='SELECT') = 1
--         and count(*) filter (where cmd='INSERT') = 1
--         and count(*) filter (where cmd in ('UPDATE','DELETE','ALL')) = 0
--        then 'PASS - readable and appendable, and a comment cannot be edited or removed'
--        else 'FAIL - see the counts'
--   end as verdict
-- from pg_policies where tablename = 'anomaly_comments';


-- VERIFY (c) — ★★ THE GATE REFUSES A DISMISSAL WITH NO REASON. A rule nobody has watched
-- refuse anything is a rule on paper (the standard `071` and `076` were held to). Rolled
-- back either way. Run the WHOLE block as ONE statement — the rollback is what makes it safe.
--
-- do $$
-- declare v text; a uuid;
-- begin
--   select id into a from public.anomalies where status = 'open' limit 1;
--   if a is null then
--     raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no open anomaly to test against';
--   end if;
--   begin
--     update public.anomalies set status = 'dismissed', dismissed_reason = null where id = a;
--     v := 'FAIL - a dismissal with NO REASON was accepted';
--   exception
--     when insufficient_privilege then v := 'PASS - refused (RLS)';
--     when others then v := 'PASS - refused: ' || SQLERRM;
--   end;
--   raise exception 'CHECK RESULT (not an error - this rolled back on purpose): %', v;
-- end $$;
--
-- ▶ NOTE ON HOW THIS ONE CAN MISLEAD: run as the OPERATOR, `is_company_reviewer` returns
-- true through the platform-admin bypass, so this checks the REASON half only. The
-- REVIEWER half cannot be proved from this account at all — the operator's own login
-- cannot fail it (§3 Option A, the same trap that blocked the sign-off proof). It belongs
-- to the non-reviewer probe TIER 1 #8 now unblocks, and is recorded as OWED, not done.


-- VERIFY (d) — ★ AND THE HOUSEKEEPING STILL WORKS. Without this, (c) passing is equally
-- consistent with "we gated dismissal" and "we broke every other update", which is the
-- `079` failure exactly: for a guard, blocking too much is the dangerous direction.
--
-- do $$
-- declare v text; a uuid;
-- begin
--   select id into a from public.anomalies where status = 'open' limit 1;
--   if a is null then
--     raise exception 'CHECK RESULT (not an error): INCONCLUSIVE - no open anomaly to test against';
--   end if;
--   begin
--     update public.anomalies set last_seen_at = now() where id = a;
--     v := 'PASS - ordinary anomaly housekeeping still works';
--   exception when others then v := 'FAIL - a non-dismissal update was blocked: ' || SQLERRM;
--   end;
--   raise exception 'CHECK RESULT (not an error - this rolled back on purpose): %', v;
-- end $$;
