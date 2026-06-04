# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start Vite dev server (http://localhost:5173)
npm run build     # Production build
npm run preview   # Preview production build locally
```

No test suite or linter is configured.

## Architecture

This is a single-page React app built with Vite + Supabase. The entire application lives in **one file: `src/App.jsx`** (~7400 lines). There is no routing library — views are switched via a `view` state string inside the `ERP` component.

### Component hierarchy

```
AppWrapper          — auth state machine (session → companies → view routing)
  AuthScreen        — email/password login & signup
  CompanySetup      — first-run company creation (seeds COA, bank account, subscription)
  ERP               — the entire application once authenticated
    CompanySwitcher — dropdown to switch between companies
```

### ERP component

`ERP` is a monolithic component that holds all state and renders different views inline using if/else blocks keyed on the `view` string. Views include: `dashboard`, `journal`, `contacts`, `reports`, `bank`, `contracts`, `recurring`, `reconciliation`, `payroll`, `settings`, `qbo` (QuickBooks Online import), and a few sub-views (AP inbox, AR aging, etc.).

State is loaded once via `loadAllData()` when `currentCompany.id` changes. This function pulls from Supabase and populates: `invoices` (journal entries mapped to a flat display format), `contacts`, `rules` (GL coding rules), `contracts`, `bankTransactions`, `recurring`, `bankAccounts`, `customCOA`, `companySettings`, and others.

**View state persistence**: the active `view` is lifted up to `AppWrapper` and stored in `localStorage` (`cfai_view`) so it survives company switches and token refreshes.

### Supabase backend

- **Auth**: Supabase email/password. The auth token is maintained in a module-level `_authToken` variable and sent as a Bearer token on all API calls.
- **Database tables** (key ones): `companies`, `company_users`, `journal_entries`, `journal_entry_lines`, `accounts` (chart of accounts), `bank_accounts`, `contacts`, `contracts`, `subscriptions`
- **Edge function**: `ai-proxy` (at `supabase.co/functions/v1/ai-proxy`) — proxies requests to the Claude API with authentication. The client never holds an Anthropic API key.

### AI brain

Two-stage pipeline, both calls going through the `ai-proxy` edge function:

1. **Intent classifier** (`classifyIntent`) — Haiku (~150 tokens): classifies the message as `ledger`, `contacts`, `rules`, or `general` to decide how much context to load.
2. **Main AI** (`runAIBrain`) — Sonnet (`claude-sonnet-4-20250514`, up to 4000 tokens): receives a system prompt with the chart of accounts, vendor rules, contacts, and up to 80 ledger entries (depending on intent). Returns a JSON object `{ reply, actions[] }` where `actions` can mutate app state (recode invoices, add rules, add contacts, etc.).

### Data model: invoices

The `invoices` array is a client-side flattened view of `journal_entries` + `journal_entry_lines`. Multi-line journal entries (e.g. lease commencement, payroll) are expanded into one row per line. Simple two-line entries map to a single row. The `db_entry_id` field links back to the source journal entry.

### GL account coding

Accounts follow a numbering convention enforced by helper functions at the top of the file:
- `1xxx` = Assets, `2xxx` = Liabilities, `3xxx` = Equity
- `4xxx` = Revenue, `5xxx`/`6xxx` = Expenses
- `glIsRevenue`, `glIsExpense`, `glIsBalSheet`, `glPLType` classify accounts for P&L vs balance sheet filtering.

### ASC 842 lease accounting

`calcASC842(monthlyPayment, termMonths, annualIBR)` computes lease liability (PV of payments), ROU asset, current vs non-current portions, and a full amortization schedule using the effective interest method. This is used when adding operating leases.

### Styling

All styles are inline JavaScript objects (`const s = { ... }` pattern). The design system is a dark theme with these key colors:
- Background: `#0A0A0F` (page), `#14141A` (cards), `#1E1E2E` (inputs/hover)
- Borders: `#2A2A3E`
- Text: `#E8E8F0` (primary), `#6B6B8A` (muted)
- Accent: `#6D28D9` / `#9333EA` (purple gradient), `#10B981` (green/success)
- Font: `'DM Sans', system-ui, sans-serif`
