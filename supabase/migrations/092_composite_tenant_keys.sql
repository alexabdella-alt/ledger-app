-- ═══════════════════════════════════════════════════════════════════════════════
-- 092 — EVERY REFERENCE BETWEEN TWO TENANT ROWS STAYS INSIDE ONE COMPANY. (O139, the rest)
--
-- ★★★ `091` CLOSED ONE OF THESE WITH A TRIGGER — the one that changes the ledger's numbers.
-- The same shape sits on THIRTY-FOUR references in the live schema: each is checked for
-- EXISTENCE and never for WHOSE it is, because RLS asks `is_company_member(company_id)` of
-- the ROW and nothing of what the row points at. A customer on an invoice, the account behind
-- a bank account, a supplier rule's category, a recurring charge's two accounts, an opening
-- balance's account, a statement's document — all of them could name a row belonging to
-- somebody else and the database would accept it.
--
-- ★★★ NOT A TRIGGER THIRTY-FOUR TIMES — COMPOSITE FOREIGN KEYS. `(account_id, company_id)`
-- references `accounts (id, company_id)`, so POSTGRES enforces tenancy on the reference
-- itself: nothing to keep honest, nothing to bypass, no plpgsql to get wrong, and it cannot
-- drift as code is added. This is only available because `company_id` is NOT NULL on every
-- table on both sides — checked before writing, because under MATCH SIMPLE a single nullable
-- column would make the whole constraint silently unenforced.
--
-- ★★★ AND APPLYING IT IS AN AUDIT, NOT ONLY A FIX. A foreign key VALIDATES EVERY EXISTING ROW
-- as it is added. If this migration commits, that is proof no row in the database has ever
-- crossed companies — a question nothing can answer today. If one has, this FAILS, NAMES THE
-- ROW, and rolls back, having written nothing. **A failure here is a finding, not a mishap;
-- do not retry it, send the error.**
--
-- ★ DELETE BEHAVIOUR IS PRESERVED VERBATIM, constraint by constraint, from the definitions
-- extracted out of the live schema — `on delete cascade` where a line dies with its entry,
-- `on delete set null` where a link merely goes quiet. **Changing what happens on delete
-- while claiming to add a guard would be a second, silent change riding on the first.**
--
-- ★ `091`'s trigger STAYS. It is redundant for the account it covers and it is not the same
-- check: it also refuses an account id that exists NOWHERE, with a sentence a person can
-- read, where a foreign key gives a constraint name. Belt and braces on the one that moves money.
--
-- NOT COVERED: `inbound_messages` / `outbound_messages` (`089`/`090`) — written for O82 and
-- never applied, so those tables do not exist live. They carry the same shape and must get
-- the same treatment in the migration that creates them.
--
-- VERIFY: supabase/verify/092_composite_tenant_keys.sql — (A) before, expect FAIL;
-- (B) and (C) after, and (C) is the one that would reverse this.
-- ═══════════════════════════════════════════════════════════════════════════════
begin;

-- the (id, company_id) keys the composite references point at
create unique index if not exists accounts_id_company_idx on public.accounts (id, company_id);
create unique index if not exists anomalies_id_company_idx on public.anomalies (id, company_id);
create unique index if not exists ar_invoices_id_company_idx on public.ar_invoices (id, company_id);
create unique index if not exists bank_accounts_id_company_idx on public.bank_accounts (id, company_id);
create unique index if not exists bank_statements_id_company_idx on public.bank_statements (id, company_id);
create unique index if not exists contacts_id_company_idx on public.contacts (id, company_id);
create unique index if not exists documents_id_company_idx on public.documents (id, company_id);
create unique index if not exists fixed_assets_id_company_idx on public.fixed_assets (id, company_id);
create unique index if not exists journal_entries_id_company_idx on public.journal_entries (id, company_id);
create unique index if not exists reconciliations_id_company_idx on public.reconciliations (id, company_id);

-- each reference re-made as a COMPOSITE key, delete behaviour preserved verbatim
alter table public.ar_invoice_lines drop constraint if exists ar_invoice_lines_account_id_fkey;
alter table public.ar_invoice_lines drop constraint if exists ar_invoice_lines_account_id_company_fkey;
alter table public.ar_invoice_lines
  add constraint ar_invoice_lines_account_id_company_fkey foreign key (account_id, company_id)
  references public.accounts (id, company_id);
alter table public.ar_invoice_lines drop constraint if exists ar_invoice_lines_ar_invoice_id_fkey;
alter table public.ar_invoice_lines drop constraint if exists ar_invoice_lines_ar_invoice_id_company_fkey;
alter table public.ar_invoice_lines
  add constraint ar_invoice_lines_ar_invoice_id_company_fkey foreign key (ar_invoice_id, company_id)
  references public.ar_invoices (id, company_id) on delete cascade;
alter table public.ar_invoices drop constraint if exists ar_invoices_customer_id_fkey;
alter table public.ar_invoices drop constraint if exists ar_invoices_customer_id_company_fkey;
alter table public.ar_invoices
  add constraint ar_invoices_customer_id_company_fkey foreign key (customer_id, company_id)
  references public.contacts (id, company_id);
alter table public.ar_invoices drop constraint if exists ar_invoices_journal_entry_id_fkey;
alter table public.ar_invoices drop constraint if exists ar_invoices_journal_entry_id_company_fkey;
alter table public.ar_invoices
  add constraint ar_invoices_journal_entry_id_company_fkey foreign key (journal_entry_id, company_id)
  references public.journal_entries (id, company_id);
alter table public.bank_accounts drop constraint if exists bank_accounts_gl_account_id_fkey;
alter table public.bank_accounts drop constraint if exists bank_accounts_gl_account_id_company_fkey;
alter table public.bank_accounts
  add constraint bank_accounts_gl_account_id_company_fkey foreign key (gl_account_id, company_id)
  references public.accounts (id, company_id);
alter table public.contacts drop constraint if exists contacts_default_account_id_fkey;
alter table public.contacts drop constraint if exists contacts_default_account_id_company_fkey;
alter table public.contacts
  add constraint contacts_default_account_id_company_fkey foreign key (default_account_id, company_id)
  references public.accounts (id, company_id);
alter table public.journal_entries drop constraint if exists journal_entries_document_id_fkey;
alter table public.journal_entries drop constraint if exists journal_entries_document_id_company_fkey;
alter table public.journal_entries
  add constraint journal_entries_document_id_company_fkey foreign key (document_id, company_id)
  references public.documents (id, company_id);
alter table public.journal_entries drop constraint if exists journal_entries_reconciliation_id_fkey;
alter table public.journal_entries drop constraint if exists journal_entries_reconciliation_id_company_fkey;
alter table public.journal_entries
  add constraint journal_entries_reconciliation_id_company_fkey foreign key (reconciliation_id, company_id)
  references public.reconciliations (id, company_id) on delete set null;
alter table public.journal_entry_lines drop constraint if exists journal_entry_lines_account_id_fkey;
alter table public.journal_entry_lines drop constraint if exists journal_entry_lines_account_id_company_fkey;
alter table public.journal_entry_lines
  add constraint journal_entry_lines_account_id_company_fkey foreign key (account_id, company_id)
  references public.accounts (id, company_id);
alter table public.journal_entry_lines drop constraint if exists journal_entry_lines_contact_id_fkey;
alter table public.journal_entry_lines drop constraint if exists journal_entry_lines_contact_id_company_fkey;
alter table public.journal_entry_lines
  add constraint journal_entry_lines_contact_id_company_fkey foreign key (contact_id, company_id)
  references public.contacts (id, company_id);
alter table public.journal_entry_lines drop constraint if exists journal_entry_lines_journal_entry_id_fkey;
alter table public.journal_entry_lines drop constraint if exists journal_entry_lines_journal_entry_id_company_fkey;
alter table public.journal_entry_lines
  add constraint journal_entry_lines_journal_entry_id_company_fkey foreign key (journal_entry_id, company_id)
  references public.journal_entries (id, company_id) on delete cascade;
alter table public.opening_balances drop constraint if exists opening_balances_account_id_fkey;
alter table public.opening_balances drop constraint if exists opening_balances_account_id_company_fkey;
alter table public.opening_balances
  add constraint opening_balances_account_id_company_fkey foreign key (account_id, company_id)
  references public.accounts (id, company_id);
alter table public.opening_balances drop constraint if exists opening_balances_journal_entry_id_fkey;
alter table public.opening_balances drop constraint if exists opening_balances_journal_entry_id_company_fkey;
alter table public.opening_balances
  add constraint opening_balances_journal_entry_id_company_fkey foreign key (journal_entry_id, company_id)
  references public.journal_entries (id, company_id);
alter table public.payroll_imports drop constraint if exists payroll_imports_document_id_fkey;
alter table public.payroll_imports drop constraint if exists payroll_imports_document_id_company_fkey;
alter table public.payroll_imports
  add constraint payroll_imports_document_id_company_fkey foreign key (document_id, company_id)
  references public.documents (id, company_id);
alter table public.payroll_imports drop constraint if exists payroll_imports_journal_entry_id_fkey;
alter table public.payroll_imports drop constraint if exists payroll_imports_journal_entry_id_company_fkey;
alter table public.payroll_imports
  add constraint payroll_imports_journal_entry_id_company_fkey foreign key (journal_entry_id, company_id)
  references public.journal_entries (id, company_id);
alter table public.reconciliations drop constraint if exists reconciliations_bank_account_id_fkey;
alter table public.reconciliations drop constraint if exists reconciliations_bank_account_id_company_fkey;
alter table public.reconciliations
  add constraint reconciliations_bank_account_id_company_fkey foreign key (bank_account_id, company_id)
  references public.bank_accounts (id, company_id);
alter table public.recurring_transactions drop constraint if exists recurring_transactions_contact_id_fkey;
alter table public.recurring_transactions drop constraint if exists recurring_transactions_contact_id_company_fkey;
alter table public.recurring_transactions
  add constraint recurring_transactions_contact_id_company_fkey foreign key (contact_id, company_id)
  references public.contacts (id, company_id);
alter table public.recurring_transactions drop constraint if exists recurring_transactions_credit_account_id_fkey;
alter table public.recurring_transactions drop constraint if exists recurring_transactions_credit_account_id_company_fkey;
alter table public.recurring_transactions
  add constraint recurring_transactions_credit_account_id_company_fkey foreign key (credit_account_id, company_id)
  references public.accounts (id, company_id);
alter table public.recurring_transactions drop constraint if exists recurring_transactions_debit_account_id_fkey;
alter table public.recurring_transactions drop constraint if exists recurring_transactions_debit_account_id_company_fkey;
alter table public.recurring_transactions
  add constraint recurring_transactions_debit_account_id_company_fkey foreign key (debit_account_id, company_id)
  references public.accounts (id, company_id);
alter table public.unknown_documents drop constraint if exists unknown_documents_document_id_fkey;
alter table public.unknown_documents drop constraint if exists unknown_documents_document_id_company_fkey;
alter table public.unknown_documents
  add constraint unknown_documents_document_id_company_fkey foreign key (document_id, company_id)
  references public.documents (id, company_id);
alter table public.upload_log drop constraint if exists upload_log_document_id_fkey;
alter table public.upload_log drop constraint if exists upload_log_document_id_company_fkey;
alter table public.upload_log
  add constraint upload_log_document_id_company_fkey foreign key (document_id, company_id)
  references public.documents (id, company_id) on delete set null;
alter table public.vendor_rules drop constraint if exists vendor_rules_account_id_fkey;
alter table public.vendor_rules drop constraint if exists vendor_rules_account_id_company_fkey;
alter table public.vendor_rules
  add constraint vendor_rules_account_id_company_fkey foreign key (account_id, company_id)
  references public.accounts (id, company_id);
alter table public.vendor_rules drop constraint if exists vendor_rules_contact_id_fkey;
alter table public.vendor_rules drop constraint if exists vendor_rules_contact_id_company_fkey;
alter table public.vendor_rules
  add constraint vendor_rules_contact_id_company_fkey foreign key (contact_id, company_id)
  references public.contacts (id, company_id) on delete cascade;
alter table public.fixed_assets drop constraint if exists fixed_assets_source_journal_entry_id_fkey;
alter table public.fixed_assets drop constraint if exists fixed_assets_source_journal_entry_id_company_fkey;
alter table public.fixed_assets
  add constraint fixed_assets_source_journal_entry_id_company_fkey foreign key (source_journal_entry_id, company_id)
  references public.journal_entries (id, company_id) on delete set null;
alter table public.depreciation_schedule drop constraint if exists depreciation_schedule_asset_id_fkey;
alter table public.depreciation_schedule drop constraint if exists depreciation_schedule_asset_id_company_fkey;
alter table public.depreciation_schedule
  add constraint depreciation_schedule_asset_id_company_fkey foreign key (asset_id, company_id)
  references public.fixed_assets (id, company_id) on delete cascade;
alter table public.depreciation_schedule drop constraint if exists depreciation_schedule_journal_entry_id_fkey;
alter table public.depreciation_schedule drop constraint if exists depreciation_schedule_journal_entry_id_company_fkey;
alter table public.depreciation_schedule
  add constraint depreciation_schedule_journal_entry_id_company_fkey foreign key (journal_entry_id, company_id)
  references public.journal_entries (id, company_id) on delete set null;
alter table public.bank_statements drop constraint if exists bank_statements_bank_account_id_fkey;
alter table public.bank_statements drop constraint if exists bank_statements_bank_account_id_company_fkey;
alter table public.bank_statements
  add constraint bank_statements_bank_account_id_company_fkey foreign key (bank_account_id, company_id)
  references public.bank_accounts (id, company_id);
alter table public.bank_statements drop constraint if exists bank_statements_document_id_fkey;
alter table public.bank_statements drop constraint if exists bank_statements_document_id_company_fkey;
alter table public.bank_statements
  add constraint bank_statements_document_id_company_fkey foreign key (document_id, company_id)
  references public.documents (id, company_id);
alter table public.bank_statement_lines drop constraint if exists bank_statement_lines_statement_id_fkey;
alter table public.bank_statement_lines drop constraint if exists bank_statement_lines_statement_id_company_fkey;
alter table public.bank_statement_lines
  add constraint bank_statement_lines_statement_id_company_fkey foreign key (statement_id, company_id)
  references public.bank_statements (id, company_id) on delete cascade;
alter table public.bank_statement_lines drop constraint if exists bank_statement_lines_journal_entry_id_fkey;
alter table public.bank_statement_lines drop constraint if exists bank_statement_lines_journal_entry_id_company_fkey;
alter table public.bank_statement_lines
  add constraint bank_statement_lines_journal_entry_id_company_fkey foreign key (journal_entry_id, company_id)
  references public.journal_entries (id, company_id);
alter table public.vendor_state drop constraint if exists vendor_state_attested_account_id_fkey;
alter table public.vendor_state drop constraint if exists vendor_state_attested_account_id_company_fkey;
alter table public.vendor_state
  add constraint vendor_state_attested_account_id_company_fkey foreign key (attested_account_id, company_id)
  references public.accounts (id, company_id);
alter table public.calibration_shadow_records drop constraint if exists calibration_shadow_records_proposed_account_id_fkey;
alter table public.calibration_shadow_records drop constraint if exists calibration_shadow_records_proposed_account_id_company_fkey;
alter table public.calibration_shadow_records
  add constraint calibration_shadow_records_proposed_account_id_company_fkey foreign key (proposed_account_id, company_id)
  references public.accounts (id, company_id);
alter table public.calibration_shadow_records drop constraint if exists calibration_shadow_records_attested_account_id_fkey;
alter table public.calibration_shadow_records drop constraint if exists calibration_shadow_records_attested_account_id_company_fkey;
alter table public.calibration_shadow_records
  add constraint calibration_shadow_records_attested_account_id_company_fkey foreign key (attested_account_id, company_id)
  references public.accounts (id, company_id);
alter table public.anomaly_comments drop constraint if exists anomaly_comments_anomaly_id_fkey;
alter table public.anomaly_comments drop constraint if exists anomaly_comments_anomaly_id_company_fkey;
alter table public.anomaly_comments
  add constraint anomaly_comments_anomaly_id_company_fkey foreign key (anomaly_id, company_id)
  references public.anomalies (id, company_id) on delete cascade;

commit;
