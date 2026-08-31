# `tools/` — not shipped, not imported by the app

Nothing here is part of the client bundle. A test asserts `src/` never imports from it.

## `demoCompany.js` — the demo company's books

Generates three months of a small Austin restaurant: eleven suppliers, weekly food deliveries,
card settlements, twice-monthly payroll, and bills that are **paid a week later** so Payables
is not permanently empty. **168 entries, debits = credits exactly, 9.4% net margin.**

```js
import { demoEntries, demoSummary } from "./tools/demoCompany.js";
const entries = demoEntries({ year: 2026, months: 3 });
console.log(demoSummary(entries));   // { entries, months, debits, credits, balanced }
```

### Why it is built this way

- **It uses the product's own `buildJournalEntry`.** A fixture with its own idea of
  double-entry proves nothing about the product — that is the shape that let the payroll gate
  ship unable to fire: both sides agreeing with each other while neither agreed with the app.
- **It is deterministic by construction** — no `Math.random`, no `Date.now`, and a test that
  fails if either appears. A demo you cannot rehearse, and a drive you cannot re-run and
  compare, are both worth much less.
- **The numbers are shaped like a restaurant, not merely balanced.** The first version tied
  perfectly and showed a **54% net margin**. Balanced books are necessary and not sufficient:
  a figure no restaurateur recognises says we do not understand their business, which is
  worse than showing nothing. Food cost, labour, occupancy and the long tail of small
  recurring costs are all pinned to believable shares of sales.
- **It includes the hard case on purpose.** Bluebonnet Linen bills exactly £145 every week —
  the `O117`/`O127` population, where amount and identity carry no information. A demo that
  omits it is showing only the easy path.

### Loading it

Deliberately **not** automated here. Writing a hundred and sixty journal entries into a live
database is a production action and belongs to the operator, and it should go through
`post_journal_entry` — the single canonical write path (§7) — rather than direct inserts.

Two sane routes, whichever suits:

1. **In the app**, signed in as the demo company, paste the generated entries into a console
   loop calling the existing `persistMultiLineEntry`. Slowest, and it exercises the real path
   end to end, which is a small bonus test of the product.
2. **From SQL**, calling `public.post_journal_entry(...)` once per entry. Faster; still the
   canonical path, since that RPC *is* the write path.

Whichever is used, create the demo company through normal onboarding first so it gets a real
chart of accounts — **the point of a demo company is that it is not special.**

## `O107` note

`tests/perfProfile.test.js` and `docs/O107_SLOW_SCREENS.md` cover derivation cost; nothing in
`tools/` is involved in that.
