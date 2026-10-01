-- ═══════════════════════════════════════════════════════════════════════════════
-- 093 — HOW THE BUSINESS FILES ITS TAXES. (O140, C559)
--
-- The tax calendar showed every company every deadline — the S-Corp/Partnership return to a
-- sole proprietor, the personal return to a corporation — because nothing recorded the legal
-- form. One nullable column. NULL means "not answered" and the app keeps the full calendar, so
-- an unanswered question can never produce a SHORTER wrong one.
--
-- ★ TAX CLASSIFICATION, NOT LEGAL LABEL: a one-person LLC files like a sole proprietor, a
-- multi-member LLC like a partnership, an LLC that elected S status like an S corporation —
-- and that is what decides the deadlines. The four values are `LEGAL_FORMS` in src/lib/tax.js;
-- a test reads this file to keep the two in step.
--
-- ★ THE APP DOES NOT NEED THIS TO RUN. It writes the column in its OWN update, apart from the
-- business type and fiscal year, so before this is applied only this one field fails to save,
-- and the screen says so.
--
-- VERIFY: supabase/verify/093_legal_form.sql — three standalone checks, one verdict each.
-- ═══════════════════════════════════════════════════════════════════════════════
begin;

alter table public.companies add column if not exists legal_form text;

alter table public.companies drop constraint if exists companies_legal_form_check;
alter table public.companies add constraint companies_legal_form_check
  check (legal_form is null or legal_form in ('sole_prop', 'partnership', 's_corp', 'c_corp'));

commit;
