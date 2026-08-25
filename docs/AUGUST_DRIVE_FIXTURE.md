# AUGUST 2026 DRIVE — FIXTURE SPEC
**Written:** 2026-08-25 · **RECONCILED TO THE BUILT FIXTURE 2026-08-26** · **Company:** Franklin Ave (`3a704760-4121-41eb-be47-ab31b44a2cb3`)
**Purpose:** ROADMAP §0 TIER 1 #12 (invoice-volume drive) **plus five outstanding
verification debts** that only a live month can settle.

---

## 0. WHAT AUGUST IS AND IS NOT FOR

**IS:** the stated-period fix verified live · the payroll gate firing for the first
time and then *refusing* a bad register · 30–50 invoices through the universal drop.

**IS NOT:** a meaningful shadow-mode score. Amendment B left **every vendor STRANGER**,
so bar Toast almost everything will park. That is correct, expected, and lands in
Amendment A's **AMBIGUOUS** band by design. **August is month 1 of each vendor's
two-month clock; first real scoring is September.** Decided 2026-08-25 — deciding
`O112` first would have cost a week to make a log slightly less empty in a month with
bigger fish.

**★ BUILT 2026-08-26.** The files exist and the arithmetic closes. This document has
been reconciled to what was actually built — where the fixture differs from the original
spec it is the FIXTURE that is authoritative, and the differences are improvements. They
are marked ▲ below. The files live outside the repo, as every drive's have.

---

## 1. THE BANK STATEMENT — as built

**24 lines.** Opening **54,880.41** (July's close) + deposits **23,482.65** (10 Toast
settlements) − withdrawals **13,480.75** (14) = stated ending **64,882.31**.
Books close at **64,697.31** after cheque #1051.

**★ STATED PERIOD: 2026-08-01 → 2026-08-31.**
**★ LAST TRANSACTION: 2026-08-28** ▲ *(the second payroll debit, not 08-27)*.

**Element ① is unaffected** — a **three-day gap** between the last transaction and the
stated period end is just as decisive as four. If the parser reports `08-28`, it is
still inferring from the span; only `08-31` proves it reads the stated fact.

▲ **The fixture is richer than the spec in three ways, all of them better:**
- **Ten Toast DEPOSITS**, not one fee debit. A restaurant's card settlements are its
  revenue arriving, which is what the month actually looks like.
- **Both payroll debits are on the statement** (08-14 and 08-28, 3,150.00 each), so the
  `markAlreadyBooked` dedup probe runs **twice** rather than once.
- **Descriptor variance is built in and graded** — see §8, which replaces the element ⑨
  I was about to propose and is better than what I would have asked for.

### ③ The novel vendor ▲

`ALAMO FIRE & SAFETY LLC` — **425.00**, **2026-08-24**. Same shape as the spec's Pecan
Street and a better choice: fire-suppression service is **genuinely ambiguous** between
repairs, insurance and professional services, so there is no "obviously right" account
for a plausibility-guesser to stumble onto. In no chart, no history, no directory.
**Must land in `7150`, never `7100`.**

## 2. THE PAYROLL REGISTERS — four files ▲

Two that must post, two that must be refused **for different reasons**. The spec asked
for one of each; the fixture's second refusal is the more valuable addition.

| File | Pay date | Gross | W/h | Net | Employer | Expected |
|---|---|---|---|---|---|---|
| **02** | 2026-08-14 | 4,000.00 | 850.00 | 3,150.00 | 306.00 | **AUTO-POST** |
| **03** | 2026-08-28 | 4,000.00 | 850.00 | 3,150.00 | 306.00 | **AUTO-POST** |
| **04** | — | 4,000.00 | 850.00 | **3,200.00** | — | **REFUSE — condition 2 (FOOTS)** |
| **05** | 2026-08-31 | **12,000.00** | 2,550.00 | 9,450.00 | 918.00 | **REFUSE — condition 5 (NORM)** |

**02 and 03** sit dead-centre of the norm the backfill established (10 historical runs
at 4,000.00), so all five conditions pass. Both post **without a confirm card**, and
both net debits are on the statement.

**04 is the footing bait** ▲ — not in the original spec, and it tests the condition the
O86 phantom was built around: `4,000 − 850 = 3,150`, but the register **states 3,200**.
Condition 2 must catch a register that does not add up. **This is the first live test of
FOOTS**, and it is the check that exists because AI extraction has hallucinated totals
before.

**05 is out-of-norms and nothing else.** Pay date 08-31 against a period ending 08-28 is
**3 days — deliberately inside the 7-day grace** — so condition 4 cannot fire and the
refusal is unambiguously condition 5. That precision is the difference between "it
refused" and "it refused for the reason we think".

**Why two refusals matter:** a gate that only ever passes is untested, and a gate that
refuses everything is equally uninformative. Two passes and two refusals **on different
conditions** is the first evidence that the gate discriminates.

## 3. ⑤ THE OUTSTANDING CHEQUE — as built ▲

```
Cheque:  #1051
Date:    2026-08-29
Vendor:  Capital City Pest Control
Amount:  185.00      (Cr Cash / Dr expense)
Clears:  September
```

Written **after the last statement transaction (08-28) and inside the stated period
(→08-31)**. It is why books close at **64,697.31** against a bank ending of
**64,882.31** — a difference of exactly **185.00**.

**This is the D4 probe, and the number to hold onto.** Now that `period_end` widens to
the stated 08-31, `booksBalance` as-of 08-31 includes this cheque and the bank's ending
balance does not. **If the reconciliation difference is exactly −185.00, D4 is confirmed
and behaving correctly** — an outstanding cheque is a real timing difference, and the
right handling is the outstanding-items path, not a widened tolerance.

## 4. ⑧ THE INVOICE VOLUME — 36 files, as built ▲

**12 match bank lines · 24 unpaid at close.** An A/P balance at month end is the shape a
real client arrives in and the statement-centric drives have never produced.

**★ THE HILL COUNTRY DRIFT** ▲ — invoice **468.50** against a bank line of **486.50**.
That is an **±18.00 digit transposition**, not a rounding difference, and it is the
sharpest single item in the fixture: exact-amount matching must **fail to match** these
two, and the right outcome is an unmatched invoice and an unmatched bank line, **not** a
fuzzy match that quietly pairs them. A matcher that reconciles a transposition is a
matcher that will reconcile a wrong number.

**★ TWO INVOICES AIMED AT `O112`** ▲ — deliberately, to inform the decision rather than
pre-empt it:
- **Manchaca Auto & Fleet** — vehicle expense. This company has **no vehicle account**.
- **Spectrum Business** — internet. `6210` exists **on another company but not this one**
  (it is in `O110`'s foreign-chart set).

Both should surface the "recognised, nowhere to put it" shape. **Watch what they do; do
not fix.** This is evidence for `O112`, and the whole point is to see the failure before
choosing between create / prompt / park.

**Vendor-name format** still matters: invoice names carry the trailing period
(`Roma Cheese & Dairy Co.`) where bank strings do not. Four of five merge; **Franklin
Ave Properties splits** (`franklin ave properties` vs `…properties rent`) — the known,
accepted `O111` case.

## 5. UPLOAD ORDER — as built

1. **Register 02** (08-14). **First, alone.** The O87 live boundary check needs a clean
   JE to query before anything else touches the ledger, and this is the run that either
   proves `import_metadata` lands or repeats ·3a. **Stop and check before continuing.**
2. **Register 03** (08-28). Second auto-post — proves the gate is repeatable, not lucky.
3. **The bank statement.** Both payroll debits should now dedup against the two
   registers' `Cr Cash` legs.
4. **The 36 invoices** through the universal drop.
5. **Cheque #1051**, before reconciling.
6. **Register 04** (footing bait) → expect refusal on condition 2.
7. **Register 05** (out of norms) → expect refusal on condition 5, **last**, so the norm
   is fully established and the refusal cannot be about missing history.
8. **Reconcile, then sign off August.**

**Why 02 alone, then stop:** every other check in this drive is downstream of the gate
working. If `import_metadata` is null after step 1, the rest of the drive is still worth
running but it is a different drive — and you want to know that before uploading 36
invoices on top of it.

## 6. THE WATCH-LIST — as built

| After | Check | Expect | Debt it settles |
|---|---|---|---|
| **Register 02** | `select import_metadata from journal_entries where source='payroll' order by created_at desc limit 1` | **NOT NULL** · `kind:'payroll'` · `gross:4000` · `net:3150` | **★ THE O87 LIVE BOUNDARY CHECK.** Unit tests structurally cannot cross this boundary — it is exactly how ·3a shipped inert. **Stop here if null.** |
| Register 02 | Posted with no confirm card? | **Yes** | The gate FIRING, first time ever |
| Register 03 | Same again | **Yes** | Repeatable, not lucky |
| Statement | `select period_start, period_end from bank_statements order by created_at desc limit 1` | **`2026-08-01` / `2026-08-31`** — not `08-28` | **(ii)**, deployed 2026-08-17, unverified since |
| Statement | `ALAMO FIRE & SAFETY LLC` lands where? | **`7150`**, never `7100` | Uncategorized as honest suspense |
| Statement | Do the two 3,150 debits double-book? | **No** — deduped against both registers | The `markAlreadyBooked` path, twice |
| Statement | **Which of the three variant descriptors unified?** | **Lone Star only** (computed, §8) | **★ The C200 corpus, finally exercised** |
| Invoices | Hill Country `468.50` vs bank `486.50` | **NO match** — one unmatched invoice, one unmatched line | A matcher that reconciles an ±18 transposition will reconcile a wrong number |
| Invoices | Manchaca Auto & Fleet · Spectrum Business | Surface "recognised, nowhere to put it" | **`O112` evidence.** Watch, do not fix |
| Invoices | Franklin Ave Properties across both doors | **Still splits** | `O111`, known and accepted |
| Register 04 | Refused? On which condition? | **Condition 2 (FOOTS)** | **First live test of FOOTS** — the check that exists because extraction has hallucinated totals |
| Register 05 | Refused? On which condition? | **Condition 5 (NORM) only** | The gate REFUSING on norms, never exercised live |
| Reconcile | Difference | **exactly −185.00** (cheque #1051) | **D4** — confirms the widened `period_end` behaves, and that a timing difference is a timing difference |
| Re-upload | Same statement again | Coverage holds | **D5**, the one-time transition |
| Anytime | `select * from audit_log where action='account_materialized' and created_at > now() - interval '1 day'` | **ZERO ROWS** | Any row is an **eighth materialisation door** |
| Anytime | `select company_id, code from accounts where system_role is null and origin <> 'external'` | **ZERO ROWS** | The O108 detector, restored by `073`, staying clean |
| Sign-off | The 3 open July cards | **Sweep** | `anomalySubjectPeriod`'s fallback, shipped ·3c, unproven live |

## 8. ★★ DESCRIPTOR VARIANCE — THE C200 CORPUS, FINALLY ARRIVED ▲

The C200 guard has been waiting since 2026-08-17 for descriptors that make identity
resolution *do something*. The July data could not supply them — every vendor's bank
string was byte-identical month to month, so a clean grouping result proved nothing.
**This fixture supplies them, and grades them.** Two of the three are predicted
failures, deliberately.

**I computed all three before the drive rather than leaving them as watch-items** —
identity resolution is a pure function of the two strings, so the answer is available
now and does not need a live run to discover:

| vendor | prior months | August | key (prior → August) | |
|---|---|---|---|---|
| **Lone Star** | `…LONE STAR RESTAURANT SUPPLY` | `…LONE STAR RESTAURANT SUPPLY 884213` | `lone star restaurant supply` → **same** | ✅ **UNIFIES** |
| **Roma** | `…ROMA CHEESE & DAIRY CO` | `…ROMA CHEESE + DAIRY CO` | `roma cheese and dairy` → `roma cheese + dairy` | ❌ **SPLITS** |
| **Austin Municipal** | `…AUSTIN MUNICIPAL UTILITIES` | `…AUSTIN MUNI UTILITIES` | `austin municipal utilities` → `austin muni utilities` | ❌ **SPLITS** |

**1 of 3 unifies.** Both predictions confirmed; the one flagged "genuinely unknown"
resolved, and the reason is specific:

> **`normalizeName` special-cases `&` → `" and "`, but `+` is not in its punctuation
> class at all** (`[.,/#!$%^*;:{}=\-_\`~()'"]`). So `+` **survives verbatim into the
> entity key** — `roma cheese + dairy`. It is not that `&` and `+` normalise
> differently; it is that `+` does not normalise at all.

### ★ WHY I AM NOT FIXING THE `+` CASE BEFORE THE DRIVE

It looks like a one-character fix, and it is in a *safer* class than word-stripping —
character-level equivalence cannot eat a real vendor name the way stripping "RENT" or
"SUPPLY" would. So the temptation is real.

**But Amendment A §5 already names this as a STOP condition, in the signed text:**

> *"identity resolution requires a new rail-stripping rule to reach agreement (this
> means the corpus was under-specified; extend the corpus and re-run rather than tuning
> to the answer)"*

Changing the normaliser **because I have seen the fixture** is tuning to the answer —
the ·3a shape, where the test is reshaped until it agrees with the code. The fixture was
built to find out what happens; the finding is that two of three split, and that is the
result, not a bug to be edited away before it is recorded.

**The principled route for Roma and Austin Municipal is the ALIAS mechanism (`O111`)** —
a human attests that two strings are the same vendor, and the link is recorded rather
than inferred. That is precisely what `O111` was minted for, and this fixture has just
made the case for it concrete instead of hypothetical.

**Watch-list item:** record which of the three unified, and treat the two splits as
`O111`'s acceptance criteria — the alias feature is done when a human can reunify
`roma cheese + dairy` and `austin muni utilities` in one action each.

## 7. WHAT THIS FIXTURE DELIBERATELY DOES NOT TEST

- **Shadow-mode scoring.** Every vendor is STRANGER (Amendment B); only Toast will
  produce a non-park. Run it, record it, and read it as AMBIGUOUS — **not** as a pass.
- **`O112` — and Franklin Ave is the lucky exception.** `066` VERIFY (b) found
  `merchant_processing_fees` on only **1 of 11** companies, and that one is Franklin Ave
  (`6520`, blessed by `068`). So Toast SHOULD propose `6520` here, and August is a
  usable probe of the UNIVERSAL path even while `O112` stays undecided for the other
  ten. **If Toast parks with `directory_role_absent_from_chart` instead, something is
  wrong with the role lookup and not with `O112`** — that distinction is the reason to
  watch it.
- **The alias mechanism (`O111`).** Franklin Ave rent will split across the two doors.
  Confirm the split; do not fix it here.
- **Descriptor variance.** Every vendor's bank string is byte-identical to July's, so
  identity resolution has no work to do — the C200 corpus gap is unchanged and still
  owed.
