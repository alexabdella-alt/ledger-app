# WHAT SEVEN DRIVES NEVER ASSERTED

**Written 2026-08-27, after `O127` was caught by a pre-registered criterion that named a specific
vendor and a specific direction of surprise.**

**Purpose: convert an unknown into a bounded one.** Drives O83–O87 were scored on what *should
happen*. **None asserted what should STILL BE THERE afterward** — so none of them could detect a
silent deletion, a suppressed flag, or a card that vanished. This file lists, per drive, the
absence-criterion a `§2`-style check *would* have made.

**This is NOT a to-do list and NOT an investigation.** It is the exposure, named. Where a check is
cheap against today's data it is flagged **▶ CHEAP**; everything else stays listed and unrun.

> **The general shape of the gap, in one sentence: every drive asserted that the right things
> appeared, and none asserted that the right things were still there. A missing card has no pixel.**

---

## O83 — January/February · bank import, reconcile, the duplicate incident

| would have asserted | why it matters |
|---|---|
| **The 14 double-booked entries must STILL be soft-deleted.** | They were remediated by scripted DB access. Nothing has ever re-checked that the remediation held — and `restoreJournalEntries` exists. **▶ CHEAP** — one query on `deleted_at`. |
| Re-uploading the statement must add **zero** new journal entries — asserted as a *count of new*, not as *"nothing appeared"*. | The whole incident was double-booking; the fix was line-level idempotency. |
| The outstanding item must **still be outstanding** after the session, not silently cleared. | |

## O84 Part 1 — March · the persisted-statement pipeline

| would have asserted | why it matters |
|---|---|
| **The Atlas outstanding check must NOT be booked a second time** *and* must **still exist** as an outstanding item until genuinely cleared. | It was the first item to survive across periods. |
| **The 5 low-confidence exceptions must still be 5** after C191 — not silently resolved by the fix. | C191's bug was that exceptions were *invisible in both the DB and the UI*. A fix that made them vanish would have looked identical to a fix that made them work. |
| The payroll legs must **stay out** of the open-bills universe. | *(This one effectively fired — `ap_tie` failed by exactly gross+employer. It is the closest any drive came to an absence check, and it came from a CONTROL TOTAL, not from the drive script.)* |

## O84 Part 2 — April · the dirty path

| would have asserted | why it matters |
|---|---|
| **The mystery deposit must REMAIN excepted.** A later pass must not quietly book it. | It was the designed trap; nothing re-checked it. |
| **Check #1043 must still be in `outstanding_books`** at the end of the drive. | The chain's first self-generated item. **▶ CHEAP** — it should now be *cleared by May*, so the assertion is "cleared exactly once, and not still open". |
| The merchant-fee booking must **still** be `6520` at sign-off, not recoded by a later sweep. | |

## O85 — May · consuming the outstanding item

| would have asserted | why it matters |
|---|---|
| **Check #1043 must leave `outstanding_books` EXACTLY ONCE**, and no other outstanding item may leave with it. | The first exercise of C187's clear path. A clear-too-many would have looked like success. |
| **The taught Lone Star mapping must still be the taught account** after the flap. | Lone Star booked at 87 in April and excepted in May; nothing asserted the *mapping* survived the confidence wobble. **▶ CHEAP.** |
| Anomalies dismissed in April must **still be dismissed**, not re-opened by the re-scan. | |

## O86 — June · the owner seat

| would have asserted | why it matters |
|---|---|
| **Exactly two Gusto entries in the month — no more and NO FEWER.** | *(The "no more" half was checked — payroll duplication. The "no fewer" half never was.)* |
| **The 16 anomalies attested at sign-off must still read `attested`**, and the count must be exactly 16. | f1's debut. A sweep that attested too many would have read as a cleaner queue. |
| Signing off must not retire a **HIGH** anomaly. | The f1 rule excludes HIGH by design; nothing asserted the exclusion held. **▶ CHEAP.** |

## O86·2 — the C198·2 verification day

| would have asserted | why it matters |
|---|---|
| **The C195(7) auto-resolve must FIRE — assert a POSITIVE COUNT of resolved orphans, not an empty queue.** | **This is the drive that taught the lesson and still did not encode it.** C195(7) shipped inert for a full release because *a block that never runs looks identical to a block with nothing to do.* It was found by inspection, not by a criterion. |
| The stash sentence must be **structurally unreachable** for a pipeline result — asserted, not reasoned. | |

## O87 — July · the first live auto-reconcile

| would have asserted | why it matters |
|---|---|
| **The 3 skipped anomaly cards must STILL BE OPEN** at the end of the drive — skipped, never silently attested. | §11 explicitly said *"leave them"*. Nothing checked that they were still there. **▶ CHEAP** — today there are **0 open anomalies**, so they were resolved *somewhere*; whether by the fixed sweep or by August's sign-off is unverified. **This is the single most checkable item on this page and the closest to a real unknown.** |
| **The 16 attested notes must be exactly 16**, and the ~18 resurrected cards must be exactly the ones f3 re-keyed. | The f3 resurrection wall was *predicted* and then eyeballed. |
| The 17 auto-booked lines must **still be 17** after the auto-reconcile completed. | |

## O88 — the August drive, Acts 1–4

*The first drive with any pre-registered criteria at all — and only for O114, only in Act 4's re-run.*

| would have asserted | why it matters |
|---|---|
| **Bluebonnet's four duplicate cards must still be there.** | **This one WAS written, and it caught `O127`.** The only absence criterion in the entire program's history, and it found a P0 in the silent direction on its first use. |
| Acts 1–3 had **none**. The payroll stamp, the period fix and the supersede were all scored on *appearance*. | e.g. *"the supersede must leave exactly one active statement, and the superseded one must still exist"* was never asserted — only that anomalies emitted once. |

---

## ✅ CHECK RUN — O87's THREE SKIPPED CARDS. 2026-08-27. **NO FINDING.**

**The question:** three anomaly cards were explicitly left open at the end of the July drive
(*"leave them"*). Today there are **zero** open. What resolved them — and did anything record it?

**ANSWER: A HUMAN DISMISSED THEM, AND IT IS FULLY AUDITED.**

All three are found, exactly three, and they are the **(v) trio**:

```
dup:bluebonnet linen service:14500:2026-07-06+2026-07-13
dup:bluebonnet linen service:14500:2026-07-13+2026-07-20
dup:bluebonnet linen service:14500:2026-07-20+2026-07-27
```

`status = dismissed` · `resolution = dismissed` · `resolved_by` **set** · resolved
**2026-08-11 02:16** · and **24 `anomaly_dismissed` audit rows against 24 dismissed anomalies —
a 1:1 match.** **Not a silent code path. Not the `O127` class. Nothing to mint.**

### The scare that wasn't, worth writing down

The grouping first read as **40 rows with `resolution='auto'` against only 16
`anomaly_auto_resolved` audit rows**, and **16 `attested` against a single
`anomaly_expired_on_signoff`** — which looks exactly like partial audit coverage.

**It is BATCH LOGGING, and the batches carry their contents.** `App.jsx:1855` logs one row per
SWEEP with `{ fingerprints: [...] }`; `App.jsx:1913` logs one row per SIGN-OFF with `period`,
`anomaly_ids` **and** `fingerprints`. So every resolution is individually traceable to the sweep
that closed it. **The audit is better than the row count implied — and "audit rows < resolutions"
is a false alarm shape worth remembering, because the honest version and the broken version look
identical from a count.**

### ★ AND A CORROBORATION FOR `O117` NOBODY WENT LOOKING FOR

**The three cards a human dismissed by hand in July are BLUEBONNET WEEKLY DUPLICATES** — the same
vendor, the same $145.00, the same 7-day spacing that produced three more in August and the
over-match in `O127`. **So the weekly-vendor false positive has been costing a human hand-clearing
every month since at least July**, and the July drive recorded it as a fingerprint-parsing curiosity
rather than as the recurring defect it was. **"A card the user sees every month is a bug wearing a
question mark" — with receipts, from a month before the rule existed.**

---

## THE BOUNDED CONCLUSION

**Four checks are cheap and would take one query each:** O83's 14 remediated entries · O84's #1043
lifecycle · O86's HIGH-anomaly exclusion · **O87's 3 skipped cards (the one worth doing first).**

**Everything else is unrecoverable without re-running the drive, and we are not re-running them.**
The exposure is: **seven drives' worth of results, each scored by a method that could not detect a
thing that quietly went missing.** The books have tied at every sign-off, which bounds it — a
silent deletion large enough to move cash would have broken a control total. **What it does not
bound is anything that vanished without touching the arithmetic: a flag, a card, an exception, a
mapping.**

**And that is exactly the class `O127` turned out to be.**
