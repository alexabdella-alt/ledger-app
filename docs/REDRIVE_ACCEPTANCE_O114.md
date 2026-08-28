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

### 0.1 ★ THIS RE-DRIVE IS NINE DOCUMENTS, NOT THIRTY-SIX — AND THAT IS NOT A CONCESSION

**Every criterion in this document is satisfied by the SPECIMEN SET**, and the specimen set is small:

| document | proves |
|---|---|
| the August bank statement | §0 — the payments must exist first |
| Roma · Toast · Alamo Fire invoices | §1 — silent attach, and §5's positive count |
| Franklin Ave invoice | §1 — the identity card, and that exact-key was not bypassed |
| Hill Country invoice | §3 — the amounts-differ card |
| Bluebonnet ×4 | §2 — the anti-vacuity check |

**Nine invoices plus one statement. At 3 AI calls each that is ~30 AI calls and 10 upload bumps —
comfortably inside BOTH walls (60 and 20), with room to spare.**

**★ SO THE O114 RE-DRIVE IS NOT GATED ON THE THROUGHPUT WORK AT ALL.** `O113a` should still land
first (a truncated run muddies any result, and the operator sequenced it that way), but **the
36-invoice volume question belongs to `O113b` and `O118`, and answering it is not a precondition for
verifying O114.** Loading 36 documents here would guarantee hitting the 20-file wall and produce a
truncated drive whose failures are throttle artefacts — testing two things at once and learning
neither, which is how §6's caveat gets invoked instead of a result.

**Run the volume drive SEPARATELY, against `O118`'s criteria, once `O118` has an answer.**

---

## 0.2 STATE AT DRIVE TIME — verified 2026-08-27, against `8190d29`

| fact | value | meaning |
|---|---|---|
| bank lines, August, live | **17** | the payment side is intact; **do NOT re-load the statement** |
| entries carrying an attach stamp | **0** | the failed 2026-08-27 attempt left **no residue** — nothing to clean |
| `universal_upload` invoices, August, live | **5** | four are non-specimens and stay; **Hill Country must go** |
| open anomalies | **1** — COGS `category_spike` | **pre-existing, category 3, NOT a specimen.** Do not count it under §1 or §2 |
| AI budget this hour | **0 / 60 · 0 / 20** | clean |

**THE COGS ANOMALY WILL PROBABLY RESOLVE ITSELF WHEN HILL COUNTRY IS DELETED**, because
that removes 468.50 of double-counted COGS. **That is the cleanup working, not the drive
fixing anything** — do not record it as a result.

## 0.3 WHAT IS ACTUALLY UNDER TEST THIS RUN

The previous attempt did not fail §1 — **it never executed the write that §1 measures.**
`checkedRowUpdate` takes `patch` and the attach passed `values`, so every attach failed and
the fallback card blamed a phantom second payment. Changed since:

1. `patch` — **the root cause**
2. `ASK_REASON.RECORD_FAILED` + honest copy — a failed write can no longer invent a ledger reason
3. attach failure now writes an `invoice_attach_failed` audit row — **it can no longer be invisible**
4. entry-level dedupe on `db_entry_id` (real, latent, unrelated to §1)
5. a repo-wide guard that every checked-write call site names its payload `patch`

**§5's `attached >= 3` is now the load-bearing criterion** — it is the one that would have
caught this on the first pass, and the reason absence-checks alone were not enough.

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

## 5.1 ★ STANDING DELIVERABLE FROM THIS DRIVE ON — THE CARD RATE, SPLIT BY CATEGORY (`O122`)

Every drive from 2026-08-27 records the card count **split three ways**, not as a total:

| category | this drive expects | rule |
|---|---|---|
| **1 · BUG** — no controller would ever ask it | **0** | a fix, not a design question |
| **2 · ONE-TIME TEACHING** — alias, first-graduation | **Franklin Ave ×1** | must be askable ONCE and then never re-asked |
| **3 · GENUINE JUDGMENT** — a real bookkeeper stops | **Hill Country ×1** | forever, and rare |

**Bluebonnet's four are category 1** under the rule *a card the user sees every month is a bug
wearing a question mark* — they recur weekly on the same question (`O117`). **§2 still requires
them to APPEAR**, because this work does not fix them; they are counted as category 1 and stay
open. Requiring their presence while classifying them as defects is not a contradiction — it is
the difference between *this change didn't touch it* and *this change fixed it*.

**A total is not acceptable.** The question is whether category 2 shrinks month over month, and a
falling total with a flat category 2 means the teaching is not sticking — invisible in aggregate.

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

---

# ═══ RESULT — SCORED 2026-08-27 against `8190d29`. §1 PASS · §2 **FAIL** ═══

**Overall: the feature works and the drive found a real defect. Not a clean pass, and it must not be recorded as one.**

| § | criterion | result |
|---|---|---|
| **0** | statement before invoices | ✅ statement pre-loaded, invoices after |
| **1** | Roma / Toast / Alamo Fire → no card, silent attach | ✅ **PASS** — all three attached, stamps verified in the DB |
| **1** | Franklin Ave → identity card, **attach would be a failure** | ✅ **PASS** — card raised, correct wording, did not attach |
| **2** | **Bluebonnet's FOUR cards must remain** | ❌ **FAIL — only THREE remain. One over-matched.** |
| **3** | Hill Country → amounts-differ card, no cause named | ✅ **PASS** — "$18.00 more than the invoice", no cause asserted |
| **4** | nothing books through the defer | ✅ n/a — no defer was exercised |
| **5.1** | `attached >= 3` | ⚠️ **4 attached, but ONE IS WRONG** — the count passes and one of its members is a defect |
| **5.2** | stamps landed | ✅ 4 entries carry `invoice_attached=true` with `attached_invoice_id` |

## ★★ §2 FAILED, AND IT FAILED EXACTLY AS WRITTEN

§2 said: *"IF BLUEBONNET'S CARDS VANISH, SOMETHING OVER-MATCHED. That is a failure of this
drive, not a pleasant surprise, and it is the single most likely way for a wrong
implementation to LOOK BETTER than a right one."*

**One vanished. Something over-matched.** Invoice `BLS-88412` (dated **2026-08-03**) attached
to the payment of **2026-07-27** — **seven days EARLIER, exactly on the `WINDOW_BEFORE_DAYS`
boundary.**

**THE EVIDENCE:** Bluebonnet pays **weekly at exactly $145.00** — 07/06, 07/13, 07/20, 07/27.
So `settlementCandidates` held **FOUR indistinguishable candidates**: same vendor, same
amount to the cent. **Only the date window separated them**, leaving 07/27 as the sole
survivor — which then satisfied *"exactly one certain candidate → ATTACH"*.

> **THE CERTAINTY WAS AN ARTEFACT OF THE WINDOW, NOT OF THE EVIDENCE.** At ±14 days there
> would have been two candidates and it would have ASKED. At ±3 there would have been none
> and it would have booked a payable. **The outcome was decided by a threshold, not by
> anything about the documents.**

**AND IT FAILED IN THE SILENT DIRECTION** — the one the entire design was built to avoid.
The 08/03 delivery's expense is now **suppressed** (filed, not booked), and the 07/27 payment
is claimed by an invoice that is not its own. **Nothing on any screen says so.**

**THIS IS `O117` WEARING THE `O114` COSTUME.** Same root property: for a **flat-fee recurring
vendor, amount + identity carry NO information**, so the match rests entirely on a date
window — **and a window is not evidence.** O117's version produces a noisy card; this
version silently suppresses a real charge, which is strictly worse. **→ `O127`.**

## CARD RATE (`O122`) — 9 documents, 5 cards

| category | n | which |
|---|---|---|
| **1 · BUG** | **3** | Bluebonnet duplicates (`O117`) — *and a 4th Bluebonnet card is MISSING, which is `O127`* |
| **2 · ONE-TIME TEACHING** | 1 | Franklin Ave identity → an `O111` alias once answered, never asked again |
| **3 · GENUINE JUDGMENT** | 1 | Hill Country's $18 gap — a controller asks this, and should, forever |

**Steady state for this document set: 1 card**, once `O117`, `O111` and `O127` land.
