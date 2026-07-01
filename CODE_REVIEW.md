# CODE_REVIEW.md — Structured code review

A running ledger of findings from a structured, multi-pass code review of the Shadow CFO
codebase. Each **pass** is a focused review of one concern (e.g. security, a subsystem, a
cross-cutting property); each pass is one section below. **Reviews are findings-only — no code
is changed during a review pass.** Fixes happen later, as separate tracked work.

## How to read this

Each finding has:
- **ID** — `CR-N`, stable and never reused.
- **Severity** — see legend.
- **Location** — `file:line` (or a region / "cross-cutting").
- **Explanation** — one paragraph: what it is and why it matters.
- **Recommended fix** — the suggested direction (not applied here).

Each pass section ends with a **Verdict** paragraph — the reviewer's overall read of that area.

### Severity legend

| | Severity | Meaning |
|---|---|---|
| 🔴 | **fix-before-launch** | Correctness/security/data-loss risk; must be resolved before real users. |
| 🟠 | **should-fix** | Real problem worth fixing soon; not a launch blocker on its own. |
| 🟡 | **improvement** | Code health / maintainability / minor correctness; fix opportunistically. |
| 🔵 | **suggestion** | Optional polish or a considered idea; take it or leave it. |

### Conventions

- Findings are grouped under the pass that surfaced them; a later pass may reference an earlier
  `CR-N` rather than re-filing it.
- Severity reflects the finding **as it stands in the code**, independent of how easy the fix is.
- Where a finding is already tracked elsewhere (ROADMAP `O#`, `VERIFICATION.md`), the entry links it.

---

## Index of passes

- **Pass 1 — Correctness & money math (GAAP/ledger)** — 2026-07-01 — 7 findings (1 🔴, 3 🟠, 3 🟡/🔵). **CR-1/CR-2/CR-3 fixed in C134**; CR-4 open; CR-5→O86, CR-6→O87, CR-7 note-only.

<!-- Each pass appended below as:  ## Pass N — <focus>  (date) ... findings ... Verdict -->

---

## Pass 1 — Correctness & money math (GAAP / ledger correctness) · 2026-07-01

Scope: the journal-write path (`persistJournalEntry`/`persistMultiLineEntry`/`buildJournalEntry`), `flattenJournalEntries`, the canonical `reports.js` derivations, settlement/reversal/void handling, `bankMatch` + the matching engine, `reconcile.js`, `payroll.js`, `depreciation.js`/`prepaid.js`, sales tax, and the monthly-report computes. Findings only — nothing changed.

Positives worth recording up front: money is handled with real discipline in the core layer — a single `r2` cent-rounding at every public boundary, balance checks compare **`r2`-normalized** totals (so `totalDebit === totalCredit` is safe, not a raw-float trap), and `reports.js` genuinely funnels most surfaces through one set of functions. The failures below are concentrated in **debit/credit direction** and **date/leg basis**, not in arithmetic precision.

---

### CR-1 · 🔴 fix-before-launch · `computeRevenue`/`computeExpenses` ignore debit/credit direction → a void/reversal DOUBLES the P&L instead of netting to zero
> **✅ FIXED — C134.** `computeRevenue`/`computeExpenses` now derive from the signed GL legs via a shared `plMovement`/`legSigned` root, so a live reversal subtracts and the P&L nets to zero. The same signing was extended to every sibling that had its *own* `amount` sum — `computeCategoryTotals`, `computeVendorTotals`, `computeKPIs` (its private `rev`/`exp`), `fiscalYearSplit` (the RE split, so the Balance Sheet ties to the Income Statement), and the burn/top-vendor sums in `businessHealth`/`financialHealthScore`/`buildMonthlyReport`. New `tests/reversalLifecycle.test.js` runs booking+reversal through the **real** `flattenJournalEntries → every report surface` and asserts nets-to-zero and the accounting equation holds. **Surfaces whose numbers change (only when a reversal/void/contra row is live):** P&L, monthly report, By Vendor/Category/Project, KPIs, RE split/Balance Sheet, tax estimate, AI snapshot — all now net correctly; cash-basis data with no reversals is unchanged to the penny.

**Location:** `src/lib/reports.js:55–62` (`computeRevenue`, `computeExpenses`, `computeNetIncome`); same pattern in `computeCategoryTotals:123` and `computeVendorTotals:141`. Interacts with `src/App.jsx:1935–1990` (`reverseJournalEntry`/`voidInvoiceWithUndo`).

**Explanation:** `computeRevenue` = `Σ num(i.amount)` over rows where `isRev(i)`, and `computeExpenses` the same over `isExp(i)` — **direction-blind**. This is only valid if every revenue-account row is a credit and every expense-account row is a debit. But **void/reversal keeps the original entry live and posts a live reversing entry** (App.jsx explicitly: *"we do NOT also set status='voided' … original + reversal both visible, net zero"*). Reversing an expense posts `Dr A/P / Cr Expense`, which flattens to one row with `gl_code=Expense`, `amount=X` → `computeExpenses` **adds** it. So original `+X` and reversal `+X` = **`2X`**, when the correct answer is `0`. Same for revenue (`Dr Revenue / Cr A/R` reversal → `computeRevenue` adds instead of subtracts). The line-level GAAP invariant test (`tests/gaapInvariants.test.js:117`) asserts the reversal nets to 0 — but it computes net income at the **line level** (`revenueDelta − expenseDelta`), and **never runs a reversal through `flatten → computeRevenue/Expenses`**, so the reporting path's double-count is completely untested. Divergent-twin corollary: `glAccountBalance` **does** net an expense reversal to 0 (it signs by `debit_credit`), so after any void the **Income Statement (2X) and Balance Sheet (0) disagree and the accounting equation stops balancing** (assets net out, net income is inflated). Blast radius is the entire reporting surface that funnels through these: P&L, monthly report, By Vendor/Category/Project, KPIs, `businessHealth`, the RE split (`fiscalYearSplit`), the AI snapshot (`ai.js`/`aiTools.js`), and **the tax estimate** (`tax.js ytdNetIncome`).

**Could this produce silently-wrong books, and for which profile?** Yes — loudly wrong, silently arrived at. **Every company profile** (cash-basis and accrual alike), because it's triggered by the ordinary, user-initiated **Void** action and the AI's `reverse_entry` capability — not by an exotic data shape. It was invisible in testing only because no test voids a P&L entry and then reads the P&L.

**Recommended fix:** compute revenue/expense from the **signed leg contribution** (debit vs credit), not raw `amount` — i.e. derive them from `glAccountBalance` over the 4xxx / 5xxx–8xxx accounts (revenue = `−Σ` credit-normal movement, expense = `Σ` debit-normal), which already nets reversals correctly. Then extend `tests/gaapInvariants` (or `multiLineEntry.test.js`) to run **a booking + its live reversal through `flattenJournalEntries → computeRevenue/computeExpenses`** and assert `0`. (Note CR-2 must be fixed in tandem for the revenue side to net.)

---

### CR-2 · 🟠 should-fix · `glAccountBalance` hard-codes every revenue-account row as a credit — contra-revenue / refunds / revenue reversals are added instead of subtracted
> **✅ FIXED — C134.** Removed the `isRev(i) ? false :` override; `glAccountBalance` now signs the primary leg via the shared `legPrimaryIsDebit` (uses the flattened `debit_credit`, `isRev` only as a legacy fallback), so a `Dr Revenue` row subtracts on **every** account class. Verified via the lifecycle suite (full/partial refund reduces revenue; `computeRevenue === glAccountBalance(REV)`). Surfaces changed: trial balance / Balance Sheet revenue for companies that issue **refunds / credit memos** or reverse a revenue entry.

**Location:** `src/lib/reports.js:205` — `const primaryIsDebit = isRev(i) ? false : i.debit_credit !== "credit";`

**Explanation:** For expense/asset/liability rows the sign is taken from the flattened `debit_credit` (correct). But for any **revenue-account** row it is *forced* to credit (`isRev(i) ? false`), ignoring the real `debit_credit`. For a normal `Cr Revenue` row this is a no-op; it only changes behavior for a **`Dr Revenue`** row (a refund, credit memo, contra-revenue, or revenue reversal), which it then signs as `+` (increasing revenue) when it should be `−`. So the Balance-Sheet/trial-balance path over-states revenue for exactly those events — a *third* hand-rolled debit→sign convention that disagrees with `cashLegSigned` and `classifyTxn`. It appears to be a legacy safety net for old rows that lacked `debit_credit`; now that `flatten` always sets it, the override is pure downside.

**Could this produce silently-wrong books, and for which profile?** Yes, for companies that issue **refunds / credit memos** or **reverse a revenue entry** (any basis). Silent: the Balance Sheet just reads a bit high with no error.

**Recommended fix:** drop the `isRev(i) ? false :` override and use `i.debit_credit !== "credit"` uniformly (matching the expense path), with a `type`-based fallback only when `debit_credit` is absent. Add a trial-balance test with a `Dr Revenue` contra row.

---

### CR-3 · 🟠 should-fix · The Cash Flow report is built on P&L membership + `payment_status`, not cash-leg participation (the generalized O88 error, third instance)
> **✅ FIXED — C134.** The Cash Flow report now buckets **actual cash-leg movements** via the `reconcile.js` primitives (`reconBooksSet` + `cashLegSigned` over the company's cash codes), dated at the cash date, at the cash-leg amount, signed by direction — the exact same basis as bank reconciliation, so the two can never disagree. Inter-account transfers (both legs cash) are skipped (net-zero to total cash). Surfaces changed: the Reports → Cash Flow statement now reflects real cash for **accrual** and **taxed-invoice** companies (previously it proxied cash from P&L rows flagged paid/collected at the recognition date).

**Location:** `src/components/views/ReportsView.jsx:122–135` (the `byMonth` inflow/outflow build).

**Explanation:** "Cash in" = `glIsRevenue(gl_code) && payment_status ∈ {collected,paid}` summing `inv.amount`; "cash out" = `glIsExpense(gl_code) && payment_status==="paid"`. This is the same category error just fixed for ReconView (C133/O88): it derives cash from **P&L rows + a denormalized flag** instead of from entries that touch the **cash account**. Consequences: (a) it counts revenue/expense at the **recognition date** (`inv.date`, the invoice date) and **ex-tax revenue amount**, not the actual cash date/amount; (b) the **real cash movements** — settlement rows `Dr Cash / Cr A/R` and `Dr A/P / Cr Cash` — are *excluded* (their `gl_code` is Cash/AP, not revenue/expense); (c) it leans on `payment_status` (the §9 flag-lie class); (d) it inherits CR-1 for reversals. It's a P&L-flag *proxy* for cash flow, not a cash-flow statement.

**Could this produce silently-wrong books, and for which profile?** The core ledger stays correct (canonical cash is `glCashOnHand`, unaffected); this is a **misleading secondary report**. Most wrong for **accrual** companies (recognition date ≠ cash date) and **taxed-invoice** companies (amount differs). A cash-basis company where invoice date ≈ payment date sees roughly-right numbers.

**Recommended fix:** rebuild the cash-flow rows from `reconcile.js` primitives — `reconBooksSet(invoices, {cashCodes})` bucketed by month, signed with `cashLegSigned` — so the statement reflects actual cash legs at the cash date/amount. Reuses the exact code that made ReconView correct.

---

### CR-4 · 🟠 should-fix · Depreciation & prepaid schedule dates: JS month-overflow for day-29–31 in-service dates, plus a `toISOString` day-shift
> **Open — not addressed in C134** (this task fixed the CR-1/2/3 direction/basis cluster). Tracked for a date-handling pass alongside O86.

**Location:** `src/lib/depreciation.js:135` and `src/lib/prepaid.js:63` — `new Date(start.getFullYear(), start.getMonth() + k, start.getDate())` then `.toISOString().slice(0,10)`.

**Explanation:** Two date bugs stacked. (1) **Month overflow:** anchoring on `getDate()` and adding months means an asset placed in service on the 31st (or 29/30) overflows short months — e.g. in-service `2026-01-31`, `k=1` → `new Date(2026, 1, 31)` = **Mar 3**, skipping February entirely and shifting every subsequent entry. (2) **TZ shift:** the generated `new Date(y, m, d)` is **local midnight**, and `.toISOString().slice(0,10)` converts to UTC, so for users behind UTC each schedule date lands a day earlier — occasionally crossing a month boundary (the input `start` is noon-anchored `T12:00:00`, so only the *generated* dates are exposed, not the parse). Either bug books a depreciation/amortization slice into the **wrong month**, so that month's P&L is off.

**Could this produce silently-wrong books, and for which profile?** Yes — any company **depreciating or amortizing** an asset whose in-service date is late in the month, amplified for behind-UTC users. Amounts are individually small but land in the wrong period silently.

**Recommended fix:** generate period dates with an explicit end-of-month-aware step (clamp `getDate()` to the target month's length, or step by "add k months to the 1st, then min(day, daysInMonth)"), and format via a **local** `YYYY-MM-DD` (compose from `getFullYear/getMonth/getDate`) rather than `toISOString`. Add schedule tests for a Jan-31 / Feb start.

---

### CR-5 · 🟡 improvement · Residual `toISOString().slice()` month/date keys in the AI + insights layer (same class as the C129 KPI bug)
> **Folds into O86** (the `toISOString` date-keying sweep). Not a separate item.

**Location:** `src/lib/ai.js:18–20` (`today`/`thisMonth`/`lastMonth`), `src/lib/aiTools.js:31–32,96` (range boundaries), `src/lib/insights.js:182`, `src/lib/clientProfile.js:81`.

**Explanation:** These derive month/date keys from `now.toISOString()` (UTC). It's the same pattern as the `computeKPIs` bug fixed in C129 and tracked under O86: for users behind UTC the key can land in the next month near a month boundary, so an AI "how did I do this month" answer or an insight card can bucket into the wrong month. Lower severity than CR-1/CR-4 because it affects **AI/insights narration**, not the stored ledger, and only near boundaries.

**Could this produce silently-wrong books?** No booked data; **AI/insight figures** can be wrong for non-UTC users on/around the 1st. **Recommended fix:** fold into the O86 date-keying sweep — key months from local components (mirror the `ymLocal` fix from C129).

---

### CR-6 · 🟡 improvement · `fiscalYearStart` Jan-1 UTC edge (already tracked as O87)
> **Tracked as O87** (address in the coordinated date-handling pass with O86). No change here.

**Location:** `src/lib/reports.js:70–76`.

**Explanation:** `fiscalYearStart` builds the boundary from local `new Date(...)` then returns `toISOString().slice(0,10)`, so a Jan-1 fiscal start can come back as `2025-12-31` in a behind-UTC browser. Consistent-by-construction with the Balance-Sheet RE split (both use this function), so it doesn't currently desync surfaces — but YTD/RE inherit the off-by-one, and any transaction dated on that boundary day would be mis-bucketed. Already logged as **O87**; recorded here so the correctness pass is complete.

**Recommended fix:** as O87 — address in the coordinated date-handling pass (O86), formatting from local components; re-verify the RE split + YTD together.

---

### CR-7 · 🔵 suggestion · `cashLegSigned` (reconcile.js) assumes `debit_credit` is present
> **Note-only** — safe today (flatten always sets `debit_credit`); no action taken.

**Location:** `src/lib/reconcile.js:44–52`.

**Explanation:** The new recon sign relies on `i.debit_credit === "debit"`. `flattenJournalEntries` always sets it, so this is safe today; but a legacy/hand-built row lacking `debit_credit` would default to the credit branch (signed as money-out). Purely defensive — flagged so a future refactor that introduces un-flattened rows doesn't silently mis-sign a reconciliation. **Recommended fix:** none required now; if desired, fall back to `classifyTxn(i).inflow` when `debit_credit` is absent.

---

### Verdict — Pass 1

**Confidence in ledger correctness: moderate, with one launch-blocking hole.** The arithmetic foundation is genuinely solid — consistent `r2` boundary rounding, normalized balance checks, and a real single-source compute layer — so I have high confidence in *precision*. Confidence in *direction and basis* is where it breaks: the codebase reasons about entries as "an amount with a type" in the reporting layer while reasoning correctly about "signed legs" in the ledger layer, and those two mental models disagree exactly at reversals, contra entries, and cash-vs-P&L basis.

**Top 3 risks:** (1) **CR-1** — voiding/reversing any P&L entry double-counts it on the Income Statement (and un-balances the equation vs. the Balance Sheet), reachable by a normal button and by the AI; this is the one that must be fixed before launch. (2) **CR-3** — the Cash Flow report isn't a cash-flow statement; it's a P&L-flag proxy that ignores the actual cash legs. (3) **CR-2** — revenue refunds/credit-memos/reversals over-state revenue everywhere because `glAccountBalance` force-credits revenue rows.

**The through-line** is the §9 / O88 family the team has been chasing one site at a time: *derive from signed GL legs, not from entry-level `amount` + a P&L/type/payment flag.* CR-1, CR-2, and CR-3 are three more faces of it in the **reporting** layer, just as O73/C127/C130/C133 were in the matching/report-source/tabs/recon layers.

**Pass-1-adjacent area that most deserves its own pass:** a **"reversal / void / contra-entry lifecycle" pass** — trace one void and one refund end-to-end through *every* surface (P&L, BS, cash flow, AR/AP aging, By Vendor/Category, KPIs, tax, AI snapshot, dashboard) and assert they all agree and net correctly. CR-1/CR-2 suggest the reversal path was validated at the builder level but never at the report level, and that gap likely hides siblings (e.g. AR/AP aging and `payment_status` interaction with a reversed collection).
