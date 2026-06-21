# ROADMAP.md — Shadow CFO, single source of truth

This is **the** authoritative roadmap. When the user says "add to the roadmap," append it here
(Section 2), don't just acknowledge it in chat. Items have stable ids (`C#` completed, `O#` open);
ids are never reused. Keep the two sections separate. Mark an item DONE only when it's genuinely in
the codebase (builder/function exists, tests pass, migration applied/committed).

- **Last updated:** 2026-06-21
- **Test suite:** 375 passing (`npm test`, 30 files). **Build:** clean (`npm run build`).
- **Migrations:** `000`–`044` (numbering non-contiguous; `042` & `044` committed this pass).
- **Evidence** column points at the commit / lib file / migration / test that proves the item.

---

## SECTION 1 — COMPLETED (verified in code)

### Accounting correctness engine (the GAAP/"one source of truth" program)

| id | item | evidence |
|----|------|----------|
| C1 | Reconciliation canonical calculation layer + reconciliation test suite (all surfaces unified) | `fcbd7de`, `reports.js`, `tests/reconciliation.test.js` |
| C2 | Schema-drift audit; missing payment/approval columns reconciled | `66e07ed`,`ef4ee19`, migrations `032`,`034`,`035` |
| C3 | DB baseline + reproducible-from-empty (`000` baseline, `036` function re-assert) | `699cfcb`,`93ab5c7`, `000_*`,`036_*` |
| C4 | Approval-status uuid write + account auto-creation column fixes (writeShapes) | `ef4ee19`, `src/lib/writeShapes.js`, `tests/schemaContract.test.js` |
| C5 | Post-booking visibility invariant + alerting | `9ddd9d3`, migration `030`, `tests/freshBooking.test.js` |
| C6 | Mark-as-Paid persistence: canonical payment state + write verification + id resolution | `7d3e4f3`,`6d3522f`, `tests/paymentState.test.js` |
| C7 | GAAP guardrail (`gaapInvariants`) — living spec over every economic event | `868e31f`, `tests/gaapInvariants.test.js` |
| C8 | Payment-posting integrity (Step 1): paying a bill posts a balanced GL entry | `183c4e4`, `src/lib/payments.js`, `tests/payments.test.js` |
| C9 | #14 Void → real GAAP reversing entry; AI reverse double-negation fixed | `fefd399`, `src/lib/journalEntries.js` (`buildReversalLines`) |
| C10 | #6/#7 Opening + bank balances on the clean-cutoff model; OBE (3400) | `e8022f0`,`c72a18e`, migrations `037`,`038`, `src/lib/openingBalances.js`, `tests/openingBalances.test.js` |
| C11 | Cutoff enforcement up front in booking handlers + optimistic-add rollback | `9a9747c` |
| C12 | Fiscal-year Retained-Earnings split (derived soft close, Option A) | `4d91359`, `reports.js` (`fiscalYearSplit`/`fiscalYearStart`) |
| C13 | AP Step 2: canonical `glAccountBalance` — Balance Sheet AP + Outstanding read one GL source | `2efb0ab`, `reports.js` (`glAccountBalance`) |
| C14 | AP Step 3: historical backfill (tested planner + idempotent one-shot) | `da46d72`,`3180fa2`, `src/lib/apBackfill.js`, migration `039`, `tests/apBackfill.test.js` |
| C15 | Single-source cluster #1: cash on hand derives from the GL | `314e7c7`, `reports.js` (`glCashOnHand`) |
| C16 | Single-source cluster #2: AR collection posts to GL + AR Outstanding GL-derived; AR backfill | `8400090`, migration `040` (no-op on current data) |
| C17 | Single-source cluster #3: AR/AP aging totals reconcile with the canonical predicates | `reports.js` (`agingReport`,`arApTotals`) |
| C18 | Single-source cluster #4: parallel P&L derivations lock-tested vs `glAccountBalance` | `11447ce`, `tests/reconciliation.test.js` (cluster-#4 lock) |
| C19 | Bank-import match→book three-bug fix (stable id, `isArMatch`, no silent flag) + integration test | `d6627b3`, `src/lib/bankMatch.js`, `tests/bankMatch.test.js` |
| C20 | Phase 0: canonical multi-line write path (`buildJournalEntry`→`persistMultiLineEntry`) | `f7db564`, `src/lib/journalEntries.js`, `tests/journalEntries.test.js` |
| C21 | Deferred-revenue double-count fix + flatten P&L-primary (computeRevenue==glAccountBalance) | `f7db564`, `src/lib/ledger.js`, `tests/multiLineEntry.test.js` |
| C22 | #11b recognition / #12 lease rerouted through the multi-line path (no per-line expansion) | `f7db564` (`postContractEntry`/`postAllContractEntries`) |
| C23 | #8 Depreciation: `fixed_assets` + `depreciation_schedule`, run-through-date, fully-depreciated flip | `2b027dd`, migration `041`, `src/lib/depreciation.js`, `tests/depreciation.test.js` |
| C24 | Depreciation silent-failure fix: atomic capitalize-or-compensate | `1ee4d72` (`createFixedAssetWithSchedule`/compensation) |
| C25 | Attach-depreciation-to-existing-asset (reusable backfill action, idempotent) | `44368be` (`attachDepreciationToExistingAsset`) |
| C26 | #11 Deferred-revenue receipt: Dr Cash / Cr Deferred Revenue (2300) | `fd9bb9a`, `src/lib/revenueEntries.js`, `tests/revenueEntries.test.js` |
| C27 | #4 AR-issue builder (Dr A/R / Cr Revenue) extracted as `buildArInvoiceEntry` | `0276897`, `src/lib/revenueEntries.js` |
| C28 | #16 Sales tax Step 1: 3-line Dr A/R / Cr Revenue / Cr Sales Tax Payable (2350), per-invoice rate | `0276897`, `tests/revenueEntries.test.js` |
| C29 | Taxed-invoice collection + aging on the FULL incl-tax A/R (no stranded tax) | `96c324a`, `tests/salesTaxAr.test.js` |
| C30 | #16 Sales tax Step 2: saved company default rate, pre-fills Send Invoice | `ac3e624`, migration `042` |
| C31 | Send Invoice null-draft crash fix (complete-draft factory + safe functional updates) | `9c9facb`, `src/lib/invoiceDraft.js`, `tests/invoiceDraft.test.js` |

### Platform, AI, reporting & product foundation (pre-existing, verified)

| id | item | evidence |
|----|------|----------|
| C32 | UI design system (Mercury/Linear/Stripe-inspired) + polish passes | `081c47a`,`1aadae2` |
| C33 | Universal upload → AI extract/code → balanced journal entries | `App.jsx` upload pipeline |
| C34 | Conversational clarification flow + free-text natural-language booking | `0d4503b`,`a63b86b` |
| C35 | AI function-calling (live DB tools) | `dca8ecf`, `src/lib/aiTools.js`, `tests/aiTools.test.js` |
| C36 | AI inline charts/CSV/summaries, smart duplicate detection, recurring suggestions | `c63cec1` |
| C37 | Adaptive client AI profile + world-class CFO prompt + action sandbox | `9a8af7a`, migration `022`, `src/lib/aiCapabilities.js` |
| C38 | Reports: P&L, Balance Sheet, Cash Flow, AR/AP aging, trial balance, KPIs, health score + drill-downs | `ee3d2bd`,`0376999`, `reports.js`, `tests/reports.test.js` |
| C39 | Tax Center: estimates, deadlines, deduction tracker, 1099s | `src/lib/tax.js`, migrations `011`,`007`, `tests/tax.test.js` |
| C40 | Bank import + reconciliation + exact-balance match | `c5c17e1`, migrations `005`,`026`,`035` |
| C41 | Contracts / ASC 842 leases (Day-1 + monthly schedules) | `App.jsx` contract flow |
| C42 | QuickBooks Online import (mapping, dup detection, undo) | `0769ab7`, migration `028`, `src/lib/qboParser.js`, `tests/qboParser.test.js` |
| C43 | Automatic monthly reporting + immutable archive + executive summary | `784765b`, migration `029`, `tests/monthlyReport.test.js` |
| C44 | Multi-user team invites (owner/admin/member roles) | `f5cf088`, migration `027` |
| C45 | Multi-tenancy via Postgres RLS (`is_company_member`) + `accounts` RLS fix | migrations `001`,`023` |
| C46 | Data safety: soft delete, audit log, undo toast, bulk-delete protection, export-all | `366f407` |
| C47 | Platform admin panel + Support Mode (Option A bypass) | `467a2ec` |
| C48 | Security verification dashboard (`security_check`) | `ce0e276`, migration `018` |
| C49 | Per-user rate limiting (60 AI/hr, 20 uploads/hr) | `1117cf9`, migration `021`, `tests/ratelimit.test.js` |
| C50 | Anomaly detection, onboarding flow, in-app notifications | `5093b23`, migration `033` |
| C51 | Upload log (per-file processing status) | `6a7290a`, migration `019` |
| C52 | OWASP Top-10 security audit pass + invoice-print XSS hardening | `6260178` |
| C53 | Terms of Service + Privacy Policy pages | `ecd3b80` |
| C54 | Sentry error-monitoring integration (code wired; DSN config is O-side) | `2fd4113`, `src/lib/sentry.js` |
| C55 | Payroll import UI + AI parse (books to ledger) — exists but NOT GAAP-correct/persisted; see O1 | `App.jsx` PayrollView |
| C56 | #14 Void persistence — void posts a **DB-persisted** reversing entry (`post_journal_entry`), idempotent via `import_metadata.reverses`; Undo soft-deletes the reversal. NOT local-only (was O15; rechecked 2026-06-21) | `fefd399`, `reverseJournalEntry`/`voidInvoiceWithUndo` in `App.jsx` |
| C57 | #13 Payroll — deterministic `buildPayrollEntry` (Dr Salaries / Dr Payroll Tax Exp / Cr Cash(net) / Cr Payroll Taxes Payable), role-resolved; fixes the never-persisted bug (PayrollView now posts via `persistMultiLineEntry`); COA role-reconciliation (mig `044`) + new `2101` Payroll Taxes Payable; preview renders the real entry | `src/lib/payroll.js`, `tests/payroll.test.js`, migration `044`, gaapInvariants #13, PayrollView |
| C59 | O37 Smart file-routing / misroute protection — deterministic `detectFileType` (header/column sniff: bank/payroll/invoice/qbo/unknown); bank/payroll/contract importers warn + offer to route on a confident mismatch (never silently mis-process); universal path sniffs spreadsheets and routes payroll/QBO instead of assuming bank. Incident (payroll CSV → 9 wrong bank entries) can't recur | `src/lib/fileDetect.js`, `tests/fileDetect.test.js`, `App.jsx` (`guardImport`/`routeFileToType`), PayrollView |
| C58 | #9 Prepaid — `buildPrepaidCapitalizeEntry` (Dr 1300 / Cr A/P) + `buildPrepaidAmortizeEntry` (Dr expense / Cr 1300) + `buildPrepaidSchedule` (monthly, last month absorbs rounding → Σ === capitalized, no stranded residual). `bookPrepaid` rerouted off inline/`bookToDb` → builders + `persistMultiLineEntry`. Role-resolved (`prepaid_expenses`). Generate-upfront model kept (no schedule table); contract amortize path already correct post-Phase-0 | `src/lib/prepaid.js`, `tests/prepaid.test.js`, gaapInvariants #9/#9b, `bookPrepaid` |

---

## SECTION 2 — OPEN / NOT STARTED

Priority: **P1** now/next · **P2** soon · **P3** later/launch · **P4** deferred-by-design.

### ▶ Suggested execution order

Ordered index into the items below (ids are stable; the category tables that follow are the source of truth for each item's detail). `→` = do in this sequence.

- **PHASE 1 — Perfect the common paths** (95% of client usage; do first):
  **O37** (file-misroute protection) → **O12** (vendor report bug) → **O13** (settings persist) → **O38** (high-frequency path hardening) → **O41** (clean-company shakedown).
- **PHASE 2 — Trust & integrity** (the "books you can trust" promise):
  **O49** (AI-accuracy verification) → **O42** (invoice-disappearance safeguard) → **O7** (coverage audit) → **O21** (RLS audit) → **O16** (GL cash integrity) → **O50** (CPA-review-efficiency).
- **PHASE 3 — Common-path features clients want soon:**
  **O11** (invoice due-dates) → **O45** (bulk mark-paid) → **O46** (batch payments) → **O51** (scoped deletion) → **O3** (accrued liabilities) → **O6** + **O40** (remittance events).
- **PHASE 4 — UX & polish:**
  **O20** (reports redesign) → **O39** (progressive disclosure) → **O14** (render-test harness) → **O43**, **O44**, **O52**, **O53**, **O54** (smaller fixes).
- **PHASE 5 — Launch gates** (near ship):
  **O22** (rebuild test) → **O25** (codebase review) → **O23**/**O24** (DPA/SOC2) → **O26** (Sentry DSN) → **O30** (Stripe) → **O31** (custom domain). Plus opportunistic: **O8**, **O9**, **O10**, **O17**, **O18**, **O19**, **O35**, **O36**, **O4**+**O5** (hard close + period-locking — pair; not in the original phase spec, parked here).
- **PHASE 6 — Deferred / post-launch** (P4 + big features):
  **O32**, **O33**, **O34** (variant deferrals) → **O27**, **O28**, **O29** (integrated payments, receipt submission, Slack) → **O47**, **O48** (volume/scale, chatbot-config).

### ★ North star (vision-tier)

**O56 — "Invisible controller" experience.** The client interacts via an **INBOX** (email and/or Slack) where they forward everything — receipts, invoices, statements — which feeds directly into the app and **becomes the permanent document record**. A **chatbot** (in Slack *and* in-app) answers questions and generates reports on request ("send me my P&L", "how much on travel this quarter?"). Behind the scenes the AI controller does the bookkeeping and the **CPA reviews**. Goal: the client forwards documents and asks questions; their finances feel **handled by a person, not operated by them via software**. The app UI exists for those who want it but isn't required for the core experience. **P3 / vision-tier** — the organizing goal the near-term work serves.

Existing items that ladder into it:
- **O29** (Slack/SMS bot) — the chat interface layer (Slack + in-app).
- **O28** (expense/receipt submission) — the forwarding/inbox **input**.
- **Source-document attachment** (being designed now) — the inbox auto-becomes the **audit trail**; forwarded receipts auto-match to transactions.
- **O49** (AI-accuracy verification) + **CPA review** (**O50**) — the **trust layer** that MUST be solid before the experience can be hands-off.
- **O38** (high-frequency path hardening) — the bank-flow + categorization the controller runs behind the scenes.

**Sequencing:** this is a LATER build that sits on top of a **bulletproof core**. Hands-off only works when the behind-the-scenes result is trustworthy (accurate categorization + review). Build the core first (engine done; **O38**/**O49** in progress), *then* this delivery layer.

### Accounting events & correctness

| id | item | status | pri | deps/notes |
|----|------|--------|-----|-----------|
| ~~O1~~ | #13 Payroll — GAAP-correct multi-line builder + never-persisted fix | → C57 | — | done 2026-06-21 (migration `044`) |
| ~~O2~~ | #9 Prepaid — shape-extract builders + route off inline `bookPrepaid` | → C58 | — | done 2026-06-21 |
| O36 | Unify amortization schedules (prepaid + depreciation + lease) under one model — prepaid/contracts generate-upfront (posted future-dated JEs) while depreciation uses a pending-rows table + run-on-demand. Consolidate to one mechanism for consistency | not started | P3 | surfaced by C58; correctness is fine today, this is consistency/UX |
| O3 | #10 Accrued liabilities — discrete builder + test (currently only implicit via payroll/AP offsets) | not started | P2 | gaapInvariants has the literal; no dedicated builder |
| O4 | #17 Hard close — post year-end closing entries (Dr Rev/Cr Exp → Retained Earnings 3100) + period locking | not started | P3 | soft-close (C12) is the correctness fix; pairs with O5 |
| O5 | Reconciliation period-locking | not started | P3 | pairs with O4 |
| O6 | Sales-tax remittance event — Dr Sales Tax Payable (2350) / Cr Cash when remitting to the state | not started | P2 | completes the #16 lifecycle (2350 currently only accrues) |
| O40 | Payroll-tax remittance event — Dr Payroll Taxes Payable (2101) / Cr Cash when collected payroll taxes are paid to the government; clears the liability | not started | P3 | companion to O6; closes the #13 lifecycle (2101 currently only accrues) |
| O7 | Comprehensive economic-event coverage audit — verify all 17 events + edge cases end-to-end | not started | P2 | depends on O1,O2 |
| O8 | Reversal display marker — show original struck-through / "reversed on DATE" (display-only via `import_metadata.reverses`) | not started | P3 | follow-up to C9 |
| O9 | "Redo opening setup" flow — guarded reverse of the posted opening entry + unlock cutoff | not started | P3 | follow-up to C10 |
| O10 | Depreciation month-end auto-prompt (currently manual "Run depreciation through DATE") | not started | P2 | follow-up to C23 |
| O11 | Invoice due-date end-to-end (set, surface in aging/collections, reminders) | not started | P2 | |

### Bugs & technical debt

| id | item | status | pri | deps/notes |
|----|------|--------|-----|-----------|
| O12 | Vendor report shows customers (By-Vendor report mixes AR customers into vendor list) | open bug | **P1** | classify by AP vs AR / contact type |
| O13 | Company settings fields don't persist to DB — `SettingsView.save()` only sets local state + bank accounts; only `sales_tax_rate` now writes to `companies` (name/address/fiscal/defaults are lost on refresh) | open bug | **P1** | add a `companies` update for the identity/accounting fields |
| O14 | Component render-test harness (jsdom + ERP-context mock) — unit tests can't mount views; the Send Invoice crash (C31) slipped because only pure seams were tested | not started | P2 | adds a real regression layer for view logic |
| ~~O15~~ | `voidInvoiceWithUndo` persistence — **rechecked: already done → C56** (DB-persisted reversing entry, not local-only) | → C56 | — | resolved 2026-06-21 |
| O16 | GL cash integrity — audit every cash figure still derives from `glCashOnHand` (no stored-balance leak) | needs verify | P2 | guardrail extension of C15 |
| O17 | Payment atomicity — replace compensation-based payment posting with a single `pay_journal_entry` RPC (atomic flag + GL) | not started | P3 | hardening of C8 |
| O18 | Normalized reconciliations model (header + `reconciliation_items`, FK to JE lines) — denormalized shape is working today | not started | P3 | CLAUDE.md §11; deliberate separate project |
| O19 | Drop orphaned `ap_invoices` table (zero references) after confirming empty/unused | not started | P3 | CLAUDE.md §11 |
| O35 | **COA normalization (Tier-2)** — companies were seeded by different COA versions over time (e.g. `5101`/`6400` Payroll Tax Expense, `2101` Payroll Taxes Payable with NULL roles); migration `009` set roles by v2 code only, so v1-era accounts have NULL roles / vestigial codes. Audit every company for missing/NULL/variant roles and reconcile **all** roles (not just payroll). Set roles (safe); renumber codes only with a JE-line re-point plan (unsafe otherwise). Driven by a live per-company audit. | not started | **P2** | surfaced by payroll (C57/mig `044`, which fixed payroll roles only); affects any role-resolved feature for legacy companies |
| ~~O37~~ | Smart file-routing / misroute protection | → C59 | — | done 2026-06-21 (deterministic CSV sniff) |
| O55 | File-detect AI-classifier extension (fast-follow to C59) — extend the AI document classifier (PDFs/images) to include `payroll` and `qbo`, and add deterministic .xlsx (binary) sniffing via the xlsx lib; today non-CSV files → `unknown` (no mismatch warning) | not started | P2 | follow-up to C59; deterministic CSV path already covers the incident class |
| O52 | Setup-flow buttons audit — onboarding/setup buttons behave inconsistently (accountant button vanished; "setup bank" routed to balances). Verify every onboarding/setup button's action + routing | open bug | P2 | |
| O53 | Duplicate-alert routing — clicking a "possible duplicate" alert routes to Home instead of the transaction | open bug | P3 | should deep-link to the entry |
| O54 | Support-mode bugs — (a) the last-uploaded file from the platform-admin's own instance appears inside a client instance under Support Mode; (b) exiting Support Mode can get stuck on the wrong company instead of returning to the admin's own account | open bug | P2 | multi-tenant/support correctness; follow-up to C47 |

### AI quality & data trust

| id | item | status | pri | deps/notes |
|----|------|--------|-----|-----------|
| O42 | **Invoice-disappearance safeguard** — standing guarantee that anything an uploaded doc creates can never silently vanish (broader than C5's post-booking invariant; ongoing assurance, raised repeatedly). Core trust concern | not started | **P1** | extends C5/C51; wants a continuous check, not a one-shot invariant |
| O44 | Ambiguous-document handling — when an uploaded doc is unclear/ambiguous, route to review and ask rather than guessing wrong | not started | P2 | pairs with O37 + the clarification flow (C34) |
| O49 | **AI-accuracy verification layer** — a dedicated way to catch AI mistakes: bulletproof reconciliations + completeness checks confirming the AI coded things correctly and nothing is missing (broader than `gaapInvariants`; about catching AI categorization/extraction errors). Core to "books you can trust" | not started | **P1** | complements C7 (GAAP invariants) and the single-source clusters |
| O51 | Scoped deletion via chatbot — "delete the Adobe transaction" must NOT delete ALL Adobe-associated records; scope deletes precisely (single targeted entry, confirm before bulk) | not started | P2 | safety; extends the AI action sandbox (C37) bulk-delete cap |

### Bulk operations & scale

| id | item | status | pri | deps/notes |
|----|------|--------|-----|-----------|
| O45 | Mass-edit / bulk mark-paid — marking payments paid one-by-one is tedious; need bulk selection + bulk status/payment-method edit | not started | P2 | routes through `markBillPaid` (C6/C8) per selected id |
| O46 | Batch-payment matching — match a single lump/batch payment against multiple bills/invoices | not started | P2 | extends the matching engine (C19); partial/multi-clear |
| O47 | Volume/scale check — confirm the app handles large uploads (50+ invoices) and high transaction volume without breaking | not started | P2 | perf + correctness under load |

### Reports & UX

| id | item | status | pri | deps/notes |
|----|------|--------|-----|-----------|
| O20 | Reports page redesign + report date semantics (range/asOf consistency across reports) | not started | P2 | |
| O39 | **Progressive disclosure** — surface advanced accounting UI (lease/ASC 842, deferred revenue, depreciation, multi-line payroll) only when a client actually uses those features; hidden by default to reduce clutter for simple expense-first clients | not started | P2 | pairs with O20 (Reports redesign) |
| O50 | CPA-review-efficiency design — how the reviewing CPA reviews most efficiently: health-score vs spot-check vs detailed review; what gets surfaced/summarized for sign-off | not started | P2 | pairs with O49 (AI-accuracy layer) |

### Security, compliance & launch-readiness

| id | item | status | pri | deps/notes |
|----|------|--------|-----|-----------|
| O21 | Full RLS policy audit — reconcile all committed policies vs live (~135) per table | not started | **P1** | tenant-isolation assurance |
| O22 | Live rebuild test + auth-trigger capture — prove `000`→`042` rebuilds to live; the `auth.users`→`public.users` sync trigger lives outside `public` and isn't in `000` | not started | P2 | CLAUDE.md §11 caveat |
| O23 | Data-processing / AI disclosure — DPA, subprocessor list, training opt-out, prompt-injection policy | not started | P3 | |
| O24 | GITC / SOC 2 readiness | not started | P3 | |
| O25 | Pre-launch industry-standard full codebase review | not started | P3 | gate before launch |
| O26 | Sentry DSN setup (integration C54 exists; production DSN + env config) | not started | P2 | |

### Pre-ship milestones

| id | item | status | pri | deps/notes |
|----|------|--------|-----|-----------|
| O38 | **High-frequency path hardening** — dedicated correctness + polish pass on the paths an expense-first client uses daily: expense capture (receipt/bill upload → AI categorization → correct expense account, with easy correction when miscategorized), bank feed (import/match/categorize), revenue capture, and clean P&L/expense reports for the simple case. ~95% of real usage; about perfecting common flows, not adding event types (lease/deferred-rev/depreciation/payroll are done but lower-frequency) | not started | **P1** | pre-ship; pairs with O37, O20/O39 |
| O41 | **Clean end-to-end shakedown** — build a fresh company from scratch with current code and run a full normal cycle (set cutoff → opening balances → book/pay bills → issue/collect invoices → run depreciation → pull financial statements), confirming everything ties with no manual SQL or cleanup. Proves the product works whole and surfaces common-path rough edges in context (vs. accumulated mess in Test 1) | not started | **P1** | pre-ship milestone; depends on O37/O38 fixes landing |

### Product features

| id | item | status | pri | deps/notes |
|----|------|--------|-----|-----------|
| O27 | Integrated vendor payments (actually pay bills, not just record) | not started | P3 | |
| O28 | Expense / receipt submission (employee capture flow) | not started | P3 | |
| O29 | Slack / SMS bot interface | not started | P3 | |
| O30 | Stripe billing (subscription/usage) | not started | P3 | |
| O31 | Custom domain support | not started | P3 | |
| O43 | Split invoices — split one invoice/bill into multiple line items or allocations (e.g. across GL accounts / projects) | not started | P2 | multi-line booking already supported via C20 |
| O48 | Chatbot-configurable features — explore letting users customize/configure features via the chat interface | not started | P3 | feasibility discussion first |

### Standard-variant deferrals (common case built; full variants known, not silently missing)

| id | item | status | pri | deps/notes |
|----|------|--------|-----|-----------|
| O32 | Sales tax: multi-jurisdiction / per-line rates + universal-upload sales path | deferred | P4 | extends C28 |
| O33 | Depreciation: declining-balance, units-of-production, MACRS (+ mid-year conventions) | deferred | P4 | extends C23; `method` column already gated |
| O34 | Payroll: accrue-then-pay two-step (accrue to liability, relieve on disbursement) | deferred | P4 | extends O1 |

---

### Maintenance protocol
- New work the user asks to "add to the roadmap" → append as the next `O#` (never reuse ids).
- When an `O#` ships, move it to Section 1 as the next `C#`, fill the evidence column, and strike its `O#` line (leave a one-line "→ C#" pointer so ids stay stable).
- Update the header (date, test/migration counts) whenever Section 1 changes.
