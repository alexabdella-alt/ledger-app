# O107 — Why the slow screens are slow

**Measured 2026-08-30. Findings only — the roadmap item says measure and report the causes
first, propose fixes after. Nothing here has been changed.**

## What was measured

`tests/perfProfile.test.js` runs the **real** derivation functions over synthetic ledgers and
reports milliseconds. Synthetic because the *shapes* cost the time, not the values — and it
means anyone can re-run it with no production access.

## Result 1 — the calculations are not the problem, and this was the surprise

| derivation | 2,000 entries | 20,000 entries | cost of 10× the data |
|---|---|---|---|
| `flattenJournalEntries` | 3.34 ms | 24.30 ms | 7.3× |
| `computeRevenue` | 0.33 ms | 0.78 ms | 2.3× |
| `computeExpenses` | 0.41 ms | 1.01 ms | 2.5× |
| `computeNetIncome` | 0.41 ms | 1.86 ms | 4.5× |
| `glAccountBalance` | 0.16 ms | 0.29 ms | 1.8× |
| `glCashOnHand` | 0.15 ms | 0.47 ms | 3.1× |
| `trialBalance` | 0.33 ms | 2.17 ms | 6.6× |

**Every one is linear or better, and all of them are fast.** A real client year is 250–1,000
entries; at *twenty thousand* the entire derivation layer costs about 30 ms. Nothing here
degrades, and there is no quadratic hiding in the reporting code.

★ **So the obvious suspect is innocent, and the investigation has to go elsewhere.** That is
worth stating plainly, because "the reports must be slow, look how much they compute" is
exactly the plausible answer someone would have optimised against for a week.

The test now **guards** this rather than only reporting it: each derivation must stay roughly
linear across 10× the data. The assertion is on the *scaling ratio*, never absolute
milliseconds — a machine-dependent millisecond threshold is flaky and would be ignored within
a month, and **a function that doubles when the data doubles is fine at any size; one that
quadruples is what eventually stops a screen rendering.**

## Result 2 — loading a company is 18 network round trips, in series

`loadAllData` is 188 lines containing **18 sequential `await`s across 11 tables** — `companies`,
`bank_accounts`, `contacts`, `vendor_rules`, `recurring_transactions`, `ar_invoices`,
`documents`, `opening_balances`, `reconciliations`, `audit_log`, `upload_log` — with **zero
`Promise.all`**. The whole file has 122 `supabase.from(...)` call sites and 7 RPCs, and
**two** `Promise.all` in 8,600 lines.

These queries are independent of one another: none needs another's result. So the wall-clock
cost is the *sum* of eighteen latencies where it could be the *maximum* of eighteen. At a
typical 60–150 ms each, that is **roughly 1–3 seconds of pure waiting on every company load
and every company switch**, none of it computation.

★ This is measurable in the browser and has not been: the fix, whatever it is, should be
judged against a real before/after in the Network panel rather than against this estimate.

## Result 3 — the context object is rebuilt on every render, with 407 keys

`erpCtx` is a plain object literal (`const erpCtx = { ...407 keys }`) handed straight to
`ERPContext.Provider`. It is **not** memoised, so a new object identity is created on every
render of `ERP` — which means **every component calling `useERP()` re-renders whenever any
state anywhere in `ERP` changes**, including a keystroke in the chat box or a toast appearing.

There are **19 `useMemo` and 0 `useCallback`** in the file, so every handler passed through
that context is also a fresh identity each render.

★ **This is the cause most likely to match the symptom people actually report** — not "the app
takes a while to load" but "it feels sluggish while I use it". Result 2 explains a slow
*arrival*; this explains slow *typing*.

## What is deliberately NOT in this document

No fixes, and no ordering of fixes. Results 2 and 3 both have well-known remedies and both
touch the single busiest file in the codebase, so each deserves its own change with its own
before/after measurement — which is the whole reason the item asked for causes first.

One caveat on Result 1 worth carrying into any later work: it measures the **pure** layer. It
says nothing about React's own render cost with these values, which is Result 3's territory.
