# RE-DRIVE ACCEPTANCE CRITERIA — O114 / O117

**Written 2026-08-26, BEFORE the re-drive and before the remaining O113 work is built.**
**Specified in advance precisely so that neither party can rationalise the result afterwards.**

Every criterion below is **binary** and states **what a failure means**, so a result cannot be
re-interpreted once it is in hand. Where a criterion could pass for the wrong reason, the wrong
reason is named.

---

## 0. THE PRECONDITION — WITHOUT THIS THE DRIVE PROVES NOTHING

> **★★ THE STATEMENT MUST BE LOADED BEFORE THE INVOICES.**

O114 is an **order-dependence** bug. Invoice-first was *always* correct — the bank rail found the
open payable and cleared it. If the re-drive loads invoices first, `planInvoiceArrival` finds no
settlement, returns `book_payable` for everything, and **the entire feature never executes.** The
books would come out clean, every card would be absent, and none of it would be evidence.

**A clean result from an invoice-first drive is a VACUOUS PASS and must be reported as a
non-result, not as a pass.**

**Second precondition:** the drive must run **inside one clock hour with a fresh AI budget**, or
`O113c`'s fixed window will truncate it and the truncation will be indistinguishable from a feature
failure. Confirm `rate_limit` is clear for the hour before starting.

---

## 1. THE FOUR CARDS THAT MUST BE GONE — AND WHAT REPLACES THEM

**The distinction matters and must not be blurred:** three of these should produce **no card at
all**; the fourth should produce a **different** card. "Gone" does not mean "silent" for all four.

| vendor | today | required after | if it still shows the old card |
|---|---|---|---|
| **Roma Cheese & Dairy** | `duplicate_payment` | **NO CARD.** Silent attach | the matcher did not run, or identity did not resolve |
| **Toast** | `duplicate_payment` | **NO CARD.** Silent attach | the directory canonicalisation is not reaching the invoice path |
| **Alamo Fire & Safety** | `duplicate_payment` | **NO CARD.** Silent attach | the `and`/`&` comparison fix is not live |
| **Franklin Ave Properties** | `duplicate_payment` | **A LIFECYCLE CARD — "we can't tell whether that's the same company."** NOT an attach, NOT a duplicate card | identity is over-matching (if it attached) or the plan is not reached (if unchanged) |

**★ FRANKLIN AVE AUTO-ATTACHING IS A FAILURE, NOT A BONUS.** Its entity keys differ by a purpose
suffix; attaching would mean the exact-key rule was bypassed. Silent success here is worse than the
card, because a wrong attach suppresses a real charge with nothing left on screen.

---

## 2. THE FOUR THAT MUST REMAIN — THE ANTI-VACUITY CHECK

> **★★ BLUEBONNET'S FOUR `duplicate_payment` CARDS MUST STILL BE THERE.**

Bluebonnet is a **weekly fixed-fee vendor** hitting `gapDays <= 7` by construction — `O117`, a
different bug that this work does not touch. A test already asserts these return `book_payable`.

**IF BLUEBONNET'S CARDS VANISH, SOMETHING OVER-MATCHED.** That is a **failure of this drive**, not a
pleasant surprise, and it is the single most likely way for a wrong implementation to *look* better
than a right one. Their survival is what proves the change was **targeted** rather than merely
**quieting**.

---

## 3. HILL COUNTRY — THE CARD, NOT AN ATTACH

Invoice **468.50** against a bank line of **486.50**.

- **REQUIRED:** the amounts-differ lifecycle card, stating both amounts and the $18.00 difference.
- **FAILURE — auto-attach:** the exact-amount rule was bypassed; an $18 discrepancy was silently
  absorbed.
- **FAILURE — no card and a payable booked:** the pair was not considered at all; the expense is
  now double-counted, which is the original bug intact.
- **FAILURE — the card names a cause** ("typo", "transposition", "looks like an error"): a Q9
  violation. A pinned test guards the source, but the *rendered* string is what is being judged here.

---

## 4. THE DEFER MUST NOT BOOK

> **★ NO INVOICE MAY REACH THE LEDGER AT `confidence: 100` THROUGH THE DEFER PATH.**

Answering *"Not sure — set it aside for my accountant"* must post **nothing**. Verify by query, not
by screen:

```sql
-- Any entry booked during the drive whose clarification was deferred. MUST RETURN 0 ROWS.
select je.id, je.entry_date, je.description, je.import_metadata
from journal_entries je
where je.company_id = '<FRANKLIN AVE>'
  and je.created_at >= '<drive start>'
  and je.import_metadata->>'ai_confidence' = '100'
  and exists (select 1 from audit_log a
              where a.action = 'invoice_deferred'
                and a.detail like '%' || split_part(je.description, ' – ', 1) || '%');
```

**FAILURE MEANS** the defer is behaving like today's "Not sure" — which books at `confidence: 100`,
the one value that guarantees `shouldFlagForReview` returns nothing. See §9's standing rule.

**And the corresponding positive check — the defer must ROUTE:** every deferred document's intake row
reads `held_for_review`, and it appears on the CPA review screen. **A defer that books nothing but
routes nowhere is a procrastinate button, and fails this criterion just as hard as one that books.**

---

## 5. THE LEDGER CHECKS — ASSERT THE MECHANISM FIRED

A clean queue and a feature that never ran look identical from outside. That is the C195(7) lesson,
where a block was unreachable for a whole release because its input array was always empty. **So the
drive asserts a POSITIVE COUNT, not an absence.**

1. **`attached` ≥ 3.** Roma, Toast and Alamo Fire must each produce an `invoice_attached` audit row.
   **Zero attaches with zero cards is a VACUOUS PASS**, and almost certainly means §0 was violated.
2. **The stamp landed.** Each attached payment carries `import_metadata->>'invoice_attached' = 'true'`
   with an `attached_invoice_id`. This is the only thing preventing a *second* invoice claiming the
   same payment, so its absence is a silent-write failure (C189/C191 class), not cosmetic.
3. **The expense is booked ONCE per attached pair.** For each of the three: exactly one live journal
   entry, and **no open payable**. This is the actual bug; everything else is instrumentation.
4. **`account_materialized` = 0 rows.** Nothing in this feature may reach `ensureAccount` or the
   `DEFAULT_BY_ROLE` absorber.
5. **No signed month is written to.**
6. **`7100` gains no lines.** TIER 1 #7's hard fail is untouched by this work.

---

## 6. WHAT THIS DRIVE DOES *NOT* PROVE — stated now, so it is not claimed later

- **`O117` is not fixed** and Bluebonnet will still be noisy (§2 requires it).
- **`O111` is not built**, so Franklin Ave still asks rather than attaching (§1 requires it).
- **The A/R mirror is untested** — deliberately out of scope.
- **Partial payments remain unbuilt.** The $18 case produces a *question*, not a partial settlement.
- **A 36-invoice run does not clear** until `O113a` stops charging for refusals. **If the drive is
  truncated by the throttle, that is an `O113` result, not an `O114` result**, and the O114 criteria
  above are simply unproven — not failed.

---

## 7. SEQUENCING (operator, 2026-08-26)

1. **`O113a`** — rejected calls stop charging. A correctness bug in the limiter, independent of any
   limit value. **A re-drive cannot clear 36 invoices until this is fixed**, because every failure
   currently deepens the hole.
2. **O113 part (b)** — settle whether `classify-document`, `extract-invoices-batch` and
   `code-invoices-batch` need three separate round trips.
3. **Then re-drive**, against these criteria.

**`AI_LIMIT` is not to be touched** until 1 and 2 are resolved.

---

**STATUS: WRITTEN IN ADVANCE. No result yet. Nothing below this line until the drive runs.**
