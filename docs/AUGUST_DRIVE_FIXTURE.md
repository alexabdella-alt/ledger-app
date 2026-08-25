# AUGUST 2026 DRIVE — FIXTURE SPEC
**Written:** 2026-08-25 · **Company:** Franklin Ave (`3a704760-4121-41eb-be47-ab31b44a2cb3`)
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

**Nothing in this file has been built.** No fixture exists in the repo; there is no
`fixtures/` directory and never has been. Every drive to date ran on files made outside
it, and this one does too.

---

## 1. THE BANK STATEMENT

**Account:** Franklin Ave operating checking (the `1000` cash account).
**★ STATED PERIOD: 2026-08-01 → 2026-08-31.** The statement header MUST say `08-31`.
**★ LAST TRANSACTION: 2026-08-27.** Nothing may be dated 08-28 → 08-31.

That gap is the whole point of element ①: it is the only way to tell whether the
parser now reads the *stated* period or still infers it from the transaction span.

| # | Date | Descriptor — use VERBATIM | Amount | Element |
|---|---|---|---|---|
| 1 | 2026-08-01 | `ACH DEBIT - FRANKLIN AVE PROPERTIES LP RENT` | −2,400.00 | ④ |
| 2 | 2026-08-03 | `ACH DEBIT - BLUEBONNET LINEN SERVICE` | −145.00 | ④ |
| 3 | 2026-08-04 | `ACH DEBIT - ROMA CHEESE & DAIRY CO` | −548.30 | ④ |
| 4 | 2026-08-06 | `ACH DEBIT - TOAST INC MERCHANT FEES AUG` | −502.15 | **②** |
| 5 | 2026-08-07 | `GUSTO PAYROLL 080726` | −3,150.00 | ⑥ |
| 6 | 2026-08-10 | `ACH DEBIT - BLUEBONNET LINEN SERVICE` | −145.00 | ④ |
| 7 | 2026-08-11 | `ACH DEBIT - LONE STAR RESTAURANT SUPPLY` | −1,326.55 | ④ |
| 8 | 2026-08-17 | `ACH DEBIT - BLUEBONNET LINEN SERVICE` | −145.00 | ④ |
| 9 | 2026-08-18 | `ACH DEBIT - AUSTIN MUNICIPAL UTILITIES` | −391.20 | ④ |
| 10 | 2026-08-19 | `ACH DEBIT - HILL COUNTRY MILLING CO` | −467.85 | ④ |
| 11 | 2026-08-20 | `ACH DEBIT - PECAN STREET COLD STORAGE` | −615.00 | **③** |
| 12 | 2026-08-24 | `ACH DEBIT - BLUEBONNET LINEN SERVICE` | −145.00 | ④ |
| 13 | 2026-08-27 | `ACH DEBIT - ROMA CHEESE & DAIRY CO` | −531.75 | ④ **← LAST** |

**Opening balance:** whatever July's statement closed at.
**Stated ending balance:** opening − 11,113.80 (the sum above).

### Notes on specific rows

**Row 4 — Toast.** The month suffix `AUG` is deliberate and load-bearing. Identity
resolution *cannot* merge `…FEES AUG` with `…FEES JAN`/`FEB`/`APRIL` — they normalise
to four different keys — and it must not learn to, because word-stripping would also
eat "Lone Star Restaurant **Supply**". The **directory** should recognise it anyway,
via the one `prefix` entry (`toast merchant fees`). This is the only element that will
produce a non-park in shadow mode.

**Row 5 — payroll on the bank rail.** `3,150.00` is **net** (gross 4,000 − 850
withholdings), matching January and February's historical bank lines. It should
**dedup** against the register's `Cr Cash` leg via `markAlreadyBooked` (date + amount +
direction) and NOT book twice. Watch that it does.

**Row 11 — the novel vendor.** `PECAN STREET COLD STORAGE` is chosen to be plausibly
a real restaurant supplier and to exist in **no chart, no history, no directory**. It
must book to **`7150` Uncategorized**, never `7100` Miscellaneous. This is the Culinary
Edge shape, handled correctly.

**Row 2/6/8/12 — Bluebonnet, four Mondays.** August has a fifth Monday (08-31) and it
is **deliberately omitted** so the last transaction stays 08-27. If you prefer realism,
move that invoice to September's statement rather than adding it here.

---

## 2. THE PAYROLL REGISTERS — two files

### ⑥ REGISTER A — must AUTO-POST
```
Provider:        Gusto
Period:          2026-07-26 → 2026-08-08
Pay date:        2026-08-07
Total gross:      4,000.00
Total deductions:   850.00
Total net:        3,150.00
Employer taxes:     306.00
Employees:        4
```
Gross **4,000.00 exactly** matters: the backfill stamped **10 historical runs at 4,000**,
so the trailing average is 4,000 and this sits dead-centre of the ±50% norm band. All
five gate conditions should pass and it should post **without a confirm card**.

### ⑦ REGISTER B — must be REFUSED
```
Provider:        Gusto
Period:          2026-08-09 → 2026-08-22
Pay date:        2026-08-21
Total gross:     12,000.00
Total deductions: 2,550.00
Total net:        9,450.00
Employer taxes:     918.00
Employees:        4
```
Foots correctly, shape is valid, pay date is adjacent — **it fails only condition 5**,
gross 12,000 against a 4,000 norm. Deliberately not on the statement: it is a bonus run
that never cleared in August. **A gate that only ever passes is an untested gate**, and
this is the half of ·3a that has never been exercised on live data.

---

## 3. ⑤ THE OUTSTANDING CHEQUE

One **manually entered** payment, in the app, not on the statement:

```
Date:    2026-08-29
Vendor:  Hays County Health Dept
Memo:    CHECK #1051 — annual food service permit
Amount:  425.00   (Cr Cash / Dr a licences-or-miscellaneous expense)
```

Dated **after the last statement transaction (08-27) but inside the stated period
(→08-31)**. This is a real outstanding cheque, and it is the **D4** probe: now that
`period_end` widens to the stated date, `booksBalance` as-of 08-31 includes it while
the bank's ending balance does not.

---

## 4. ⑧ THE INVOICE VOLUME — 30 to 50 files

Through the **universal drop**, as PDFs or images. This is TIER 1 #12's actual gate:
the engine is proven on a statement-shaped path and a real client arrives
invoice-shaped.

**Composition:**
- **~20 from vendors already on the statement** — Roma Cheese & Dairy Co., Lone Star
  Restaurant Supply, Hill Country Milling Co., Austin Municipal Utilities, Franklin Ave
  Properties LP. These exercise the **READ** identity path and the **merge** across two
  doors.
- **~10 from new vendors** not on any statement — genuinely new suppliers, small
  amounts, so they park.
- **~5 receipts** rather than invoices — photographed, imperfect, no clean header.
- **2–3 deliberately awkward:** a handwritten receipt, a duplicate of one already
  submitted, and one with no vendor name at all.

**Vendor-name format matters.** Use the vendor's *invoice* name, not the bank string —
e.g. `Roma Cheese & Dairy Co.` **with** the trailing period, `Hill Country Milling Co.`,
`Franklin Ave Properties LP`. Four of those merge with their bank identity;
**Franklin Ave will split** (`franklin ave properties` vs `franklin ave properties
rent`) and that is the known, accepted `O111` case — confirm it still splits rather
than being surprised by it.

---

## 5. UPLOAD ORDER — this matters

1. **Register A (⑥).** First, so the boundary check has a clean JE to query before
   anything else touches the ledger.
2. **The bank statement (①–④).**
3. **The invoice volume (⑧).**
4. **Register B (⑦).** Last — after the norm exists, so its refusal is about *norms*
   and not about missing history.
5. **The outstanding cheque (⑤)** any time before reconciling.

---

## 6. THE WATCH-LIST

| After | Check | Expect | Debt it settles |
|---|---|---|---|
| Register A | `select import_metadata from journal_entries where source='payroll' order by created_at desc limit 1` | **NOT NULL**, `kind:'payroll'`, `gross:4000`, `net:3150` | **The O87 live boundary check.** Unit tests structurally cannot cross this boundary — it is exactly how ·3a shipped inert |
| Register A | Did it post without a confirm card? | **Yes** | The gate FIRING, for the first time ever |
| Statement | `select period_start, period_end from bank_statements order by created_at desc limit 1` | **`2026-08-01` / `2026-08-31`** — not `08-27` | **(ii), deployed 2026-08-17, unverified.** A silent model failure looks identical to the old behaviour |
| Statement | `PECAN STREET COLD STORAGE` lands where? | **`7150`**, not `7100` | Uncategorized as honest suspense; keeps TIER 1 #7's Miscellaneous hard-fail meaningful |
| Statement | Does row 5 double-book payroll? | **No** — deduped against the register | The `markAlreadyBooked` path, which is what actually handled Gusto in June/July |
| Reconcile | Does it still auto-complete? | **Possibly not** — the 08-29 cheque may break the tie | **D4.** If it drops to `attention`, that is EXPECTED and fails safe, not a regression |
| Re-upload | Re-upload the same statement | Coverage still holds | **D5**, the one-time transition |
| Register B | Refused with a plain reason? | **Yes** — condition 5, gross outside norms | The gate REFUSING. Never yet exercised live |
| Anytime | `select * from audit_log where action='account_materialized' and created_at > now() - interval '1 day'` | **ZERO ROWS** | Any row is an **eighth materialisation door** |
| Anytime | `select company_id, code from accounts where system_role is null and origin <> 'external'` | **ZERO ROWS** | The O108 detector, restored by `073`, staying clean |
| Sign-off | 16 notes attest, 3 July cards sweep | The (v) trio clears | The `anomalySubjectPeriod` fallback, shipped ·3c, unproven live |

---

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
