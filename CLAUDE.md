# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start Vite dev server (http://localhost:5173)
npm run build     # Production build
npm run preview   # Preview production build locally
npm test          # Run the Vitest suite (tests/ directory)
npm run test:watch
```

No linter is configured. Always run `npm run build` before committing — it's the de-facto type/syntax check.

---

## 1. Project overview & tech stack

**Shadow CFO** is a single-page AI accounting/bookkeeping app for small-business owners: drop in a document (invoice, receipt, bank statement, contract) and the AI extracts it, codes it to the right GL account, books a balanced double-entry journal entry, and answers CFO-level questions in plain English.

- **Frontend:** React 18 + Vite. No routing library — views are switched via a `view` state string in the `ERP` component.
- **Backend:** Supabase (Postgres + Auth + Storage + Edge Functions). Postgres Row Level Security is the tenant-isolation boundary.
- **AI:** Anthropic Claude (Haiku classifier + Sonnet brain), proxied through a Supabase Edge Function so the API key never reaches the client.
- **Charts/tests:** dependency-free inline SVG (no recharts); Vitest for unit tests.
- **Styling:** all inline JS style objects. Dark auth screens; light app shell. Inter font, DM Mono for numbers. Accents: indigo `#4F46E5`, green `#039855`, amber `#DC6803`, red `#D92D20`.

The entire authenticated app lives in **`src/App.jsx`** (~4000+ lines). Views were progressively extracted into `src/components/views/*` and shared logic into `src/lib/*`, but `ERP` in `App.jsx` still holds nearly all state and is the source of truth via `ERPContext`/`useERP()` (~300 keys).

### Component hierarchy
```
AppWrapper          — auth state machine (session → companies → view routing)
  AuthScreen        — email/password login, signup, password reset
  CompanySetup      — first-run company creation (seeds COA, bank account, subscription)
  ERP               — the entire application once authenticated (holds all state, provides ERPContext)
    CompanySwitcher, DashboardView, BooksView, ReportsView, TaxView, ...
    ClarificationFlow, TransactionDetailPanel, ChatRichOutput, DocumentPreviewModal
```

---

## 2. Database schema (Supabase Postgres)

All business tables carry a `company_id uuid` and are tenant-isolated by RLS (§3). Key tables:

| Table | Purpose / key columns |
|---|---|
| `companies` | Tenant root. `id`, `name`, fiscal/tax metadata. Keyed by `id` (not `company_id`). |
| `company_users` | Membership/roles. `company_id`, `user_id`, `role`, `accepted_at`. The RLS source of truth. |
| `accounts` | Chart of accounts. `company_id`, `code`, `name`, `category`, `account_type`, `system_role`, `active`, `is_system`. Unique `(company_id, code)`. |
| `journal_entries` | Double-entry header. `company_id`, `entry_date`, `description`, `source` (CHECK-constrained), `status` (`posted`/`voided`), `deleted_at`, `deleted_by`, `posted_at`, `created_by`. |
| `journal_entry_lines` | Entry lines. `journal_entry_id`, `account_id`, `debit`, `credit`, `company_id`. Debits must equal credits. |
| `bank_accounts` | Bank/credit accounts. `company_id`, `name`, `type`, `gl_code`, `last4`, `institution`. |
| `contacts` | Vendors & customers. `company_id`, `name` (unique per company), `type`, `gl_code`, 1099 fields, `payment_terms`, `tags`. |
| `vendor_rules` | Auto-coding rules. vendor → `gl_code`/`gl_name`/`project`. |
| `contracts` | Contracts/leases (ASC 842). counterparty, terms, generated entries. |
| `recurring_transactions` | Recurring expenses. vendor, amount, `frequency`, `next_date`, `gl_code`, `active`. |
| `ar_invoices` / `ar_invoice_lines` | Outgoing (sent) customer invoices. |
| `subscriptions` | App subscription/plan per company. |
| `audit_log` | Immutable activity log. `action`, `detail`, `before`/`after` jsonb, `performed_by`. Written by `logAudit`/`logAI`. |
| `documents` | Uploaded files. `name`, `mime_type`, `document_type`, `storage_path` (Storage bucket `documents`), `file_size_bytes`, `linked_invoice_id`, `tags`. |
| `reconciliations` | Bank-match sessions. The app reads/writes a **denormalized** record (`account_id`, `statement_balance`, `books_balance`, `difference`, jsonb `matched_transactions`/`unmatched_*`); the normalized `005` columns (`bank_account_id`, `statement_date`, `statement_ending_balance`) and the `reconciliation_items` table are **intentionally unused dead schema** — see §11. |
| `tax_settings` | Per `(company_id, tax_year)`: estimated payments, filed deadlines, work-from-home flag. |
| `chat_messages` | Persistent AI chat. `role`, `content`, `actions_taken` jsonb (string array OR `{actions, rich}` for inline charts). |
| `upload_log` | One row per uploaded file; processing status + result. |
| `rate_limit` | Per-user hourly counters (`user_id`, `bucket`, `hour_bucket`, `count`). RLS-on, no policies — service role only. |
| `client_ai_profile` | Per-company learned AI profile. `business_type`, `common_vendors`, `spending_patterns`, `custom_rules`, `ai_notes`. One row per company. |
| `unknown_documents` | Uploaded docs the AI couldn't classify. |

### Key RPCs (SECURITY DEFINER)
- `is_company_member(cid)` / `is_company_admin(cid)` — membership checks used by every policy.
- `create_company(...)` — atomic company + owner-membership creation (direct INSERT on `companies` is blocked).
- `seed_company_accounts(company_id)` — seeds the default COA (membership-checked).
- `post_journal_entry(...)` — atomic, balanced journal-entry write (the single DB write path for entries).
- `bump_rate_limit(user, bucket)` — atomic increment-then-check counter (service role only).
- `security_check(...)` — data-isolation self-test used by the Security dashboard.

---

## 3. Multi-tenancy & RLS

Isolation is enforced **at the database**, not the client. Every tenant table has four policies (`select`/`insert`/`update`/`delete`) of the form `using (public.is_company_member(company_id))`. `is_company_member` is `SECURITY DEFINER` so it can read `company_users` with RLS bypassed (avoids recursion and is fast). Migration `001` applies these in bulk to the core tables; later migrations add the same shape per new table.

- The **anon key is public by design** — RLS is the real boundary. Never rely on a client-side `.eq("company_id", …)` filter for security; it's for correctness/perf only.
- **Platform-admin bypass (Option A):** `is_company_member` returns true for platform admins (`PLATFORM_ADMIN_EMAILS`) so Support Mode works through the normal client. Support-mode actions are attributed to `Platform Admin - <email>` in the audit log.
- **UI-layer complement:** switching companies calls `resetCompanyState()` so no previous company's data bleeds into the next while the new data loads.

> When adding a company-scoped table, you MUST add a migration enabling RLS + the four `is_company_member(company_id)` policies. (This audit found `accounts` was missing it — fixed in `023`.)

---

## 4. Chart of accounts & the `system_role` scheme

Account **numbering convention** (helpers in `src/lib/gl.js`):
- `1xxx` Assets · `2xxx` Liabilities · `3xxx` Equity · `4xxx` Revenue · `5xxx`/`6xxx`/`7xxx`/`8xxx` Expenses.
- `glIsRevenue`, `glIsExpense`, `glIsBalSheet`, `glPLType` classify by the first digit.

**Authoritative expense accounts** (default codes — users may rename/renumber):
`6000` Salaries & Wages · `6100` Rent & Occupancy · `6200` Utilities · `6300` Marketing & Advertising · `6400` Travel & Entertainment (meals 50%) · `6500` Technology & Software · `6600` Office Supplies · `6700` Insurance · `6800` Professional Services · `6900` Depreciation & Amortization · `7100` Miscellaneous · `8000` Interest Expense.

**Why roles, not hardcoded codes:** users can renumber/rename accounts, so code never hardcodes `"6100"`. Each default account has a stable `system_role` (e.g. `rent_occupancy`, `travel_entertainment`). Resolve via `getAccountByRole(role)?.code` (or `rc(role)`/`rn(role)` inside `ERP`). The deduction tracker, recurring detection, and AI all go through roles so totals follow the company's actual accounts. The role↔code map lives in `DEFAULT_CHART_OF_ACCOUNTS` (`src/lib/constants.js`); `useAccounts` builds the live `byRole` index.

---

## 5. AI architecture

Two-stage pipeline, both calls through the **`ai-proxy`** Edge Function (`supabase/functions/ai-proxy/index.ts`):

1. **Intent classifier** (`classifyIntent`, `src/lib/ai.js`) — Haiku (`AI_MODEL_FAST`), ~150 tokens. Classifies the message (`ledger`/`contacts`/`rules`/`general`) to decide how much context to load.
2. **CFO brain** (`runAIBrain`) — Sonnet (`AI_MODEL`), up to 4000 tokens. Receives a system prompt with: today's date + current year, the COA, vendor rules, contacts, up to 80 ledger rows, a **live financial snapshot** (`buildFinancials`), the **learned client profile** (`client_ai_profile`), and a **sandbox statement**. Returns `{ reply, actions[] }`.

**ai-proxy** authenticates the caller's Supabase JWT (service-role client), enforces rate limits (**60 AI/hr**, **20 uploads/hr** per user via `bump_rate_limit`; `x-rate-kind: upload` header tags uploads), then forwards the unchanged Anthropic Messages payload to `https://api.anthropic.com/v1/messages` with the server-only `ANTHROPIC_API_KEY`. The client never holds an Anthropic key.

**Action sandbox** (`src/lib/aiCapabilities.js`): the AI may only emit whitelisted action types (`recode`, `void_invoice`, `delete_invoice`, `reverse_entry`, `add_rule`, `add_account`, `add_recurring`, `add_contact`, `navigate`, `render_chart`, `export_csv`, `render_summary`, …). The action loop refuses + logs (`ai_action_refused`) anything else, caps bulk deletes at 3, and every data-changing action is audit-logged.

**Reply parsing** (`runAIBrain` tail): the reply is scrubbed brace-balanced (`scrubLeakedActionJson`) so action JSON never leaks into the chat bubble; actions are recovered (`extractActionObjects`) even from malformed JSON. Inline charts/CSV/summaries render via `ChatRichOutput` and persist in `chat_messages.actions_taken`.

---

## 6. Migration conventions

- Files live in `supabase/migrations/NNN_description.sql`, applied in numeric order. Wrap in `begin; … commit;`.
- **Idempotent**: `create table if not exists`, `drop policy if exists` before `create policy`, `add column if not exists`.
- Some numbers are intentionally absent from the repo (e.g. 016/017/020/024/025 were applied directly during development) — numbering is monotonic, not necessarily contiguous. New migrations take the next free number (currently next is `037`).
- Migrations are **not auto-run**; the user applies them in the Supabase SQL editor. Code that depends on a new table must degrade gracefully (try/catch, "table may not exist yet") so the app keeps working pre-migration.
- Show the SQL and get confirmation before writing code that depends on a new table.
- **`000_baseline_schema.sql` is the schema baseline** (a schema-only `pg_dump` of live). The chain is now reproducible: empty DB → `000` → `001…036` recreates the live schema (see §11). `000` uses bare `CREATE TABLE` (no `IF NOT EXISTS`) — **never run it against the existing production database; it is for an EMPTY database only.** Migrations `001…036` are idempotent (create-or-replace functions; if-not-exists tables/columns/indexes; drop-if-exists+create policies/triggers; drop+add constraints), so they re-apply cleanly on top of `000`.

---

## 7. Key architectural decisions (and why)

- **Soft delete** (`deleted_at`/`deleted_by`) instead of hard delete — recoverable, preserves the audit trail. All read queries filter `deleted_at IS NULL`; client logic also excludes `status === "voided"`/`"deleted"`.
- **Atomic journal writes via RPC** (`post_journal_entry`) — guarantees balanced, all-or-nothing double-entry writes. `persistJournalEntry`/`bookToDb` is the single write path; `source` is normalized to the CHECK-allowed set there.
- **`system_role` indirection** — see §4. Survives user renumbering.
- **Server-side AI key + rate limiting** — the edge function is the only place the Anthropic key lives; limits prevent abuse/runaway cost.
- **Adaptive `client_ai_profile`** — the AI gets smarter per client (vendor→GL memory, spending patterns) without retraining.
- **State reset on company switch** — UI-layer isolation complementing RLS.
- **Inline SVG charts** — zero new dependencies, full control, no bundle bloat.

---

## 8. Patterns to follow

- **New tenant table** → migration with RLS + the four `is_company_member(company_id)` policies; map columns back to the app shape in `loadAllData`; add to `resetCompanyState`.
- **New booking path** → go through `bookToDb`/`persistJournalEntry` (never insert journal entries directly). It handles `source` normalization, doc relinking, profile learning, and recurring detection.
- **GL lookups** → `getAccountByRole`/`rc`/`rn`, never a hardcoded code string.
- **New AI capability** → add the action to `AI_ALLOWED_ACTIONS`, document it in the prompt, add a handler in the action loop, and `logAI` it.
- **Mutations** → call `logAudit`/`logAI` so it lands in `audit_log`.
- **User input destined for HTML/CSV** → escape it (`SendInvoiceView` `esc`); use the `insights.js` CSV helpers for exports.
- **Dates** → `fmtDate` (`src/lib/format.js`); store `YYYY-MM-DD`.

---

## 9. Anti-patterns to avoid (mistakes already fixed)

- ❌ Hardcoding GL codes (`"6100"`). ✅ Use roles.
- ❌ Inserting journal entries outside `post_journal_entry`. ✅ Single RPC path.
- ❌ Trusting client-side `.eq("company_id")` as security. ✅ RLS is the boundary.
- ❌ Letting AI action JSON render in the chat reply. ✅ Brace-balanced scrub + separate `rich` array.
- ❌ Auto-navigating when rendering a chart. ✅ Only the "View full report" button navigates.
- ❌ Date filters that include the prior year for "this year"/deductions. ✅ Inject current year; filter `startsWith(year)`, exclude voided/deleted.
- ❌ Description/keyword matching for deductions or duplicates. ✅ GL-code + role for deductions; vendor-normalize + amount/date windows for duplicates.
- ❌ Leaving company-scoped state set across a company switch. ✅ `resetCompanyState`.
- ❌ Un-escaped user input in generated HTML (`document.write`). ✅ `esc()`.

---

## 10. Roadmap summary (delivered)

Core: universal upload → AI extract/code → balanced journal entries; Books (transactions, payables, AR); Reports (P&L, Balance Sheet, Cash Flow, cash vs accrual); Tax Center (estimates, deadlines, deduction tracker, 1099s); bank import + reconciliation; recurring; contracts/ASC 842 leases; QBO import; payroll import.

Data safety: soft delete + undo, bulk-delete protection, audit log for all AI actions, export-all, data-isolation Security dashboard, platform admin panel + Support Mode, upload log, per-user rate limiting.

AI: conversational clarification flow with free-text booking, adaptive `client_ai_profile`, world-class CFO prompt with live financial snapshot + proactive insights, action sandbox + capability doc, inline charts/CSV/summaries, smart duplicate detection, recurring-expense suggestions.

Security/quality: OWASP Top-10 audit (this pass) — `accounts` RLS (`023`), invoice-print XSS hardening; expanded docs; Vitest suite (`tests/`).

---

## 11. Known dead schema & future considerations

A full `information_schema` audit against the live database (the schema-drift pass) surfaced schema the app does not use. Do **not** "clean these up" reactively — each is documented and intentional:

- **Normalized reconciliations model is dead schema.** `reconciliations` was created (`005`) in a normalized shape (`bank_account_id`, `statement_date`, `statement_ending_balance`) with a child `reconciliation_items` table. The app never adopted it — ReconView and the bank-upload flow read/write a **denormalized** record instead (`account_id`, `statement_balance`, `books_balance`, `difference`, and jsonb arrays of matched/unmatched transactions). Migration `035` added those denormalized columns and relaxed the three unused NOT-NULLs so the insert succeeds. The normalized columns and `reconciliation_items` remain but are unused. **Future consideration (not now):** migrate reconciliation records to the proper normalized relational model (`reconciliations` header + `reconciliation_items` lines, FK to `journal_entry_lines`) for audit-grade record-keeping. This is a deliberate, separate project — the denormalized shape is the working source of truth today.
- **`ap_invoices` is an orphaned table** — a fully-structured parallel AP-invoice model that zero app code references (payables are booked to `journal_entries`). Left in place; drop only after confirming it's empty and unreferenced by Edge Functions.
- **Schema is now reproducible from the repo (resolved).** Previously the migrations could not rebuild from empty — ~21 core tables predate `001` with no `create table` DDL, and `001` assumes they exist. Fixed by `000_baseline_schema.sql` (a schema-only `pg_dump` of live): **empty DB → `000` → `001…036` reproduces the live schema.** Caveats: `000` is for a fresh database only (bare `CREATE TABLE`; do not run on production); it targets a fresh **Supabase** project (relies on the `auth`/`storage`/`extensions` schemas and `auth.uid()`); and a trigger on `auth.users` that syncs `public.users` lives outside `public` and is not captured by the dump.
- **Function divergence from missing migrations (resolved by `036`).** Five SECURITY DEFINER functions — `is_company_member` (the platform-admin/Support-Mode bypass), `post_journal_entry`, `seed_company_accounts`, `security_check`, `list_company_members` — were last modified live by the un-committed `016/017/020/025`, so the committed chain holds older bodies. On a rebuild, the older `create or replace` would clobber the live version. `036_reassert_baseline_functions.sql` re-asserts the live bodies verbatim (a no-op on production), so a rebuild terminates exactly at live. **Lesson:** absence of a migration file does not imply absence live (e.g. `notifications` came from an un-committed `024`); verify against `information_schema`, never infer from the repo alone.

## 12. GAAP correctness as tested code

Every economic event's journal entry must be a **pure `buildXEntry()` in a lib module with a unit test asserting exact Dr/Cr/amount, routed through the handler — never built inline in a view or by the AI.** `tests/gaapInvariants.test.js` is the living spec/guardrail: over a fixture of every event it asserts (a) Dr = Cr, (b) Assets = Liabilities + Equity + NetIncome, (c) payments/collections/opening/reversals leave net income unchanged, (d) only 4xxx/5–8xxx move net income. The AI may **reason and explain** with GAAP knowledge but **only executes whitelisted actions** (`aiCapabilities.js`); it never constructs raw entries.

**The 17-event inventory** (status tracked in the guardrail/remediation): 1 book bill, 2 pay bill (✅ Step 1), 3 direct-to-cash, 4 issue invoice, 5 collect (✅), 6 opening balances, 7 bank/cash opening, 8 depreciation, 9 prepaid capitalize+amortize, 10 accrued liabilities, 11 deferred-revenue receipt+recognition, 12 lease (ASC 842), 13 payroll, 14 void→reversing entry, 15 reversal, 16 sales tax, **17 year-end closing** (Dr each Revenue / Cr each Expense / plug net to Retained Earnings 3100; zeroes the period's P&L; new year starts at zero).

**Fiscal-year / Retained-Earnings model (built — derived soft close, Option A):** `reports.js` `fiscalYearSplit(invoices, {asOf, fiscalYearEnd, cutoffDate})` (+ pure `fiscalYearStart`) splits all-time net income into prior-fiscal-years' closed net (→ **beginning Retained Earnings**, always shown as a distinct line) and the current FY's net (→ **Net Income (current period)**), keyed off `companies.fiscal_year_end` and floored at `cutoff_date`. The Balance Sheet shows the two as separate lines summing to Total RE; `priorNet + currentNet === all-time net`, so every total and the balance check are unchanged — only the RE split. This fixes the pre-fix bug where a prior-year (e.g. 2024) loss was mislabeled "current period" and the Balance-Sheet net income diverged from the Income Statement from a client's 2nd fiscal year on. Guardrail: `gaapInvariants.test.js` "fiscal-year RE split" asserts prior+current=all-time, the year-boundary case (prior loss → beginning RE, not current), FYE handling, and cutoff flooring. No posted closing entries required (that's the deferred hard close, #17).

### Governing principles (conversion & cash)

- **Clean cutoff date ("Day One").** Each company has one `companies.cutoff_date`. The entire starting position is **one balanced opening journal entry** as of the cutoff — the prior trial balance (assets, liabilities, already-accumulated retained earnings), plugging the residual to **Opening Balance Equity (3400)**. **No transaction may be dated before the cutoff**; pre-cutoff activity is represented solely by opening balances. This makes the retained-earnings double-count structurally impossible. Enforcement is **hybrid**: `persistJournalEntry` hard-rejects pre-cutoff bookings with a redirect ("record it by adjusting your opening balances"); imports skip pre-cutoff rows; posting opening balances is hard-blocked if live pre-cutoff transactions exist (`preCutoffActivity`); legacy companies with no cutoff get no enforcement (warn-only). The cutoff is editable until the opening entry is posted, then **locked**. Opening balances post through the canonical path (`buildOpeningBalanceEntry` → `post_journal_entry`, `source='opening_balance'`) **and** persist to the `opening_balances` table (`journal_entry_id`, `posted=true`); `loadAllData` reads them back so they survive refresh. Editing = reverse/replace (soft-delete the prior opening JE + rows, repost) — never duplicate.
- **Bank-as-source-of-truth.** A bank account's `current_balance` IS the opening balance of that bank's cash GL account. It flows through the **same** opening entry (Dr that bank's cash GL / Cr OBE), keyed by GL account; bank-linked cash accounts are shown **read-only** in the opening-balances grid (valued from the bank), so no GL account is opened twice. A cash balance is never a free-floating field invisible to the GL.
- **The QBO-import model is the same** (item 43): trial balance at the cutoff as the opening entry, then live transactions forward — not bulk pre-cutoff history. Keep them consistent.

**Deferred / specified-but-not-built:** **hard close** (actually posting #17 closing entries + period locking) — build when period-locking becomes a real need; pairs with reconciliation locking. The soft-close derivation is the correctness fix; hard-close is the future locking feature. **Reversal display marker** — show the original entry struck-through / "reversed on DATE" when a live reversal links to it (display annotation only via `import_metadata.reverses`; does not affect calculations). Small follow-up to #14. **"Redo opening setup" flow** — a deliberate, guarded action that reverses the posted opening entry and unlocks the cutoff, for the rare wrongly-configured-cutoff case; default stays locked. Follow-up to #6/#7.

**Remediation order:** #14 void→reversal → #6/#7 opening + bank (with the cutoff model that prevents RE double-count) → fiscal-year RE split + #17 + multi-year guardrail assertions → AP Step 2 (canonical `glAccountBalance`) + Step 3 (backfill) → shape-extract inline builders (#4 AR, #9 prepaid, #13 payroll — payroll's net-pay-to-Accrued treatment needs explicit sign-off) → missing events (#8 depreciation, #16 sales tax, #11 deferred-revenue receipt).
