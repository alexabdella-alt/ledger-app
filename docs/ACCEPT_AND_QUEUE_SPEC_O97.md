# O97 — ACCEPT AND QUEUE

**Design spec. Drafted 2026-08-27. UNSIGNED — nothing built.**
Answers the five questions recorded with the item. `(5)` was answered when it was asked; this
settles `(1)`–`(4)` and states the shape.

---

## 0. THE DEFECT IS NOT THE CEILING'S HEIGHT

**It is that the ceiling is enforced synchronously while a human watches.** 200 files in, 20
succeed, 180 turn red, and the owner concludes the product is broken.

**Onboarding is inherently a batch job. Nobody needs January's invoices categorised in ninety
seconds.** We are failing a background workload in the foreground.

> **Raising the number moves the failure without changing its shape.** At 40/hour they watch 160
> fail instead of 180. The fix is not a bigger allowance; it is **accepting the work, telling them
> honestly when it will be done, and letting them close the tab.**

---

## 1. ACCEPT AND PROCESS ARE ONE ACT TODAY — AND THE FIX IS AN ORDERING, NOT A FEATURE

Established in code (2026-08-27):

```
App.jsx:3743   fileStoreRef.current[id] = f    → the BYTES, in an in-memory React ref
App.jsx:3748   logIntake(...)                  → the ARRIVAL, durably recorded
App.jsx:3806   classifyFile(...)               → the FIRST AI CALL
App.jsx:3877   storeDocument(...)              → Storage, only AFTERWARDS
```

**The arrival is durable. The bytes are not. The AI work begins before anything is persisted.**
A refresh between enqueue and processing loses the work while the intake row still says it arrived
— the live orphan of 2026-08-06 20:11:42.

### ★★ 1.1 THE DURABLE QUEUE ALREADY EXISTS. WE WRITE TO IT TOO LATE AND NEVER COME BACK.

**No new table.** `document_intake` records the arrival and its status; `documents.storage_path`
holds the bytes; `upload_log` records the processing outcome. **Joined, those three ARE a durable
work queue** — one that today is only ever written *after* the work it was meant to schedule.

**So the change is: move `storeDocument` AHEAD of `classifyFile`, and add something that comes
back for rows that have bytes and no outcome.**

- `storeDocument` currently takes a `document_type` that classification produces. **Store first
  with the type unknown and stamp it when classification returns** — the type is an *output* of
  processing, not a precondition for keeping the file.
- The C193 content hash is computed at `storeDocument` time, so **dedup gets stronger, not weaker**:
  identical bytes are recognised before we spend a single AI call on them.

**A migration is likely needed only for a `next_attempt_at` / `attempts` column on
`document_intake`.** ▶ HOLD, and it should be confirmed against the live table before writing.

---

## 2. WHAT THE OWNER SEES WHILE A QUEUE DRAINS

**Q9 applies to the waiting state, not just the result. A progress bar that cannot state a finish
time is a world-claim.**

**But we CAN state one honestly, and that is the whole design.** The finish time is arithmetic over
things we hold: documents remaining, the per-document call cost, and our own rate limit. It is
derived, not estimated — which also satisfies §9's *describe from the record*.

**Proposed copy:**

> **"All 214 of your documents are safely stored. We've sorted 38 so far and we're working through
> the rest — they'll be done by about 9:40 tonight. You can close this and come back; your place is
> saved."**

*(Operator decision, 2026-08-27: **change the sentence, do not build the channel.** A notification
channel is its own workstream and is not what blocks a client. **"Your place is saved" is true the
moment step 1 lands; "we'll email you" would have promised a thing we do not have** — the same
defect as the card that invented a cause, one surface over.)*

Every clause is checkable: a count we hold, a count we hold, a division, and a promise we will keep.

**What it must never say:** a percentage that moves at an unstated rate · *"a few minutes"* ·
anything implying the client should stay. **And if we cannot compute the finish time — because the
budget is shared and something else is consuming it (`O113b`) — we say the count and omit the time.
An unknown time is stated as unknown, never as a spinner.**

**★ THE LOAD-BEARING SENTENCE IS "ALL 214 ARE SAFELY STORED."** That is what converts a failure
into a wait, and it is only sayable once §1 lands. Until the bytes are durable it would be a lie.

---

## 3. FAILURE MID-QUEUE

**Skip-and-report, with bounded retry, and the two kinds distinguished.**

| kind | example | behaviour |
|---|---|---|
| **transient** | HTTP 429, network drop | **retry with backoff.** Safe only as of `O113a` — before it, every retry deepened the hole |
| **permanent** | unreadable file, unknown type | **skip, record the reason, move on** |

**Never stop the queue.** One malformed PDF must not block 213 good documents — that is the
`O113` proposal-4 failure mode arriving by a different road.

**Every skipped document must land somewhere a human sees.** It already does: an unprocessed
document leaves its intake row `held_for_review`, which `fetchDroppedIntake` selects and the
completeness net feeds to the CPA queue. **Reuse it; do not invent a second exception surface.**

**And the count must be reported as a count** — *"211 sorted, 3 we couldn't read, listed below"* —
never as a bare success. See `O128`: the same feature announcing its best outcome as zero.

---

## 4. IS PER-USER-PER-CLOCK-HOUR THE RIGHT UNIT?

**No — and the reason follows directly from naming the threat.**

`(5)` established the mechanism is well-shaped for **abuse** (per-actor, revocable) and badly shaped
for cost (should count tokens) and for upstream limits (org-wide, per-minute). **Abuse is about
SUSTAINED consumption by an actor. A first-time bulk load is bounded, attributable, and expected.**

**So: keep per-actor. Add a separate BULK-INTAKE allowance, distinct from interactive use.** A
one-time onboarding burst and a Tuesday afternoon of chat are different workloads, and today they
share one budget — which is precisely why the limit is unpredictable (`O113b`: *"20 invoices minus
whatever else you did this hour"*).

**Two properties the bulk allowance must have, or it is just a bigger number:**

1. **It must be BOUNDED PER ONBOARDING, not per hour** — a total, consumable at whatever pace the
   drain achieves. An hourly bulk limit reintroduces the clock-hour arbitrariness of `O113c`.
2. **It must not be reachable from the interactive path**, or it becomes the general limit with
   extra steps.

**No number is proposed here.** Choosing one before the queue exists would set a ceiling in a
currency we have not finished defining — and `O113b`'s lesson is that moving one limit alone
relocates the wall.

---

## 5. WHAT THIS DOES NOT DO

- **It does not make processing faster.** It makes it *absent from the user's attention*. Throughput
  is `O113` part (b) and `C203` (deleting call 3 for known vendors).
- **It does not fix `O113b`/`O113c`.** The shared bucket and the clock-hour window survive; the
  queue merely stops a human from watching them.
- **It does not notify.** *Decided 2026-08-27: the SENTENCE changed, the channel was not built.* The copy now promises only what is true — the work is saved and they can come back. **A notification channel is its own workstream and does not block a client.**
- **It does not address `O122`'s card rate.** 214 documents will produce cards; how many is that
  item's question.

---

## 6. ORDER OF WORK

1. **Durable-first intake** — `storeDocument` before `classifyFile`; type stamped on return. *This
   alone closes disclosure **C4** and makes §2's sentence true.*
2. **The drain** — come back for rows with bytes and no outcome; skip-and-report per §3.
3. **The waiting surface** — §2's copy, with the finish time derived or omitted.
4. **The bulk allowance** — §4, last, because until 1–3 exist there is nothing to size it against.

**Step 1 is independently valuable and independently shippable**, and it is the one that converts
"your upload failed" into "your upload is waiting".

---

**STATUS: STEP 1 BUILT 2026-08-27 (durable-first intake). Steps 2–4 unbuilt.**
