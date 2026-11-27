# Plan — connecting bank and card accounts (later, not at launch)

*Written 2026-11-27 at the operator's request. Status: **not scheduled** — the operator wants this "down the line", not at the beginning. ROADMAP §0 TIER 3 "bank connection".*

## Why it matters

The people Shadow is for won't upload statements every month. Everything the app does well — the questions, matching, "Were these personal?", the month-by-month checks — depends on transactions arriving. A connection makes them arrive by themselves, daily, and turns "upload your statements" from the most-skipped chore into nothing at all.

## Why not now

- It adds a company that sees bank data. The security story (CLAUDE.md §11, rung s3) must name it before anyone connects, and that wording should be checked properly.
- It costs money for every connected account, every month, from day one.
- Statement upload already works for the first customers, and their uploads teach us what a connection must handle.
- It changes what "the books are checked" means (see *Reconciliation* below), and that is worth designing once rather than twice.

## The choice of provider

| Provider | What it is | Rough cost | Notes |
|---|---|---|---|
| **Plaid** | The most widely used; most US banks and cards | Usually quoted per connected account per month, roughly $0.30–$1.50 for transactions, plus setup; volume pricing on a contract | Best coverage; the name people recognise in the "connect your bank" window |
| **Teller** | Direct connections, developer-friendly | Per-account pricing, often lower | Fewer institutions |
| **MX / Finicity** | Bank-grade aggregators | Usually a sales contract | Better suited to a later, larger stage |

*Prices change and are negotiated — get a current quote before deciding. At $99 or $279 a month and two or three accounts per customer, even the top of the range costs a few dollars per customer.*

**Recommendation when the time comes: Plaid**, for coverage. A creator's money is spread over big banks, neobanks, PayPal and cards, and an account that won't connect is a customer back to uploading.

## How it fits the app (nothing here is built)

1. **Connect** — Settings → Your business → "Connect an account" opens the provider's own window. The owner signs in to their bank there; Shadow never sees the bank password. The provider returns an access token, which is stored **only on the server** (a new edge function, like `ai-proxy` holds the AI key) — never in the browser.
2. **Bring in transactions** — a server job (`pg_cron`, as migration `101` already uses) fetches new transactions daily for each connection. They go through **the same path an uploaded statement takes** (`planBankImport` → dedupe by `bankTxnKey` → categorise → book). So rules, "told" purchases and income, and "Were these personal?" all keep working unchanged.
3. **Never twice** — a connection and an uploaded statement can cover the same days. The existing date | amount | direction key already treats a re-upload as "already booked", and the provider's own transaction id is a second, stronger key. An overlap must never double-book: the O83 lesson.
4. **Balances** — the provider reports each account's current balance. That becomes the *bank says* figure that cash on hand is checked against, replacing the typed statement balance. Cash on hand is still the books' figure (CLAUDE.md §12).
5. **Reconciliation** — "this month is checked" today means "the statement's ending balance matches the books". With a connection, the provider's balance on the last day plays that part. Decide whether a month can be signed with no statement at all, and what the accountant sees.
6. **Breakage** — connections break: a password change, re-authorisation every 90 days at some banks, a bank outage. Home needs one plain line ("Your Chase connection needs you to sign in again — tap here"), using the provider's re-connect window. A broken connection must say so, never look like a quiet month — the C195(7) lesson.
7. **Disconnect and delete** — the owner can disconnect at any time. Already-booked transactions stay (they are the books), the token is deleted, and the provider is told to drop the connection.

## Database (sketch)

- `bank_connections` — `company_id`, `bank_account_id`, provider, an encrypted reference to the server-held token, `status` (active / needs_reauth / disconnected), `last_synced_at`, `last_error`. RLS plus the four `is_company_member` policies (§3), with **no client read of the token column**.
- Each booked line also carries its provider transaction id, so dedupe has a key no human typed.

## Size

About **a week of focused work** for the first bank (connect → daily sync → dedupe → balance → re-connect prompt), plus the provider's own review before going live with real banks. Their sandbox lets it be built and tested without real accounts.

## Before starting

- [ ] A current price quote, and the provider's terms on data retention.
- [ ] Security wording that names the provider (rung s3).
- [ ] Decide what "checked" means for a month without a statement (point 5).
- [ ] A few real customers whose accounts would be connected first, so it is tested on real banks.
