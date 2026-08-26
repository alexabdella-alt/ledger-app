# O114 — THE INVOICE AND THE PAYMENT ARE ONE EVENT

**Design spec. Drafted 2026-08-26. UNSIGNED — nothing is built against this until the operator has read it.**

Same species as `docs/CALIBRATION_SPEC_O88.md`: a design session, not a bug fix. The defect is a
symptom; what is actually missing is a model of the relationship between a bill and the money that
paid it.

---

## 0. THE FINDING, RESTATED PRECISELY

`findDuplicate` (`src/lib/insights.js:35`) keys on normalised vendor + amount within 1% inside a date
window. An invoice and the bank line that paid it are **by construction** the same vendor and the same
amount a few days apart. So the detector fires on the lifecycle.

**But the flag is not the bug. The flag is the alarm on the bug.** Underneath it:

| | JE posted | offset |
|---|---|---|
| Invoice, dropped on Home | `Dr Expense / Cr Accounts Payable` | `App.jsx:4005` defaults the offset to `accounts_payable` |
| Bank debit, from a statement | `Dr Expense / Cr Cash` | `buildBankLineEntry`, `bankMatch.js:275` |

**Both hit the expense.** If both land, the P&L counts the charge twice and the payable is left open
forever. The duplicate card is the only thing between the books and that outcome — and its first,
most prominent option is **"New charge — book it"** (`ClarificationFlow.jsx:41`), which is the one
that does the damage.

### 0.1 The mechanism is ORDER-DEPENDENCE, and that is the real finding

The machinery to prevent this **already exists and already works** — on one rail only.

- `autoMatchBankLines` (`bankMatch.js:41`) matches a bank line to an open item on normalised name +
  amount within **one cent**, sided by the A/R–A/P offset code rather than a `type` string. It returns
  a deterministic clear at confidence 99. This is good code and the spec below keeps it.
- `matchableOpenItems` (`bankMatch.js:141`) defines openness correctly and structurally: an entry with
  an A/P, A/R or accrued leg that **no live clearing JE points at**, keyed on
  `import_metadata.payment_for`. Not a flag. This is the §9 doctrine working as intended.

**So: the bank line looks for an existing bill. The invoice never looks for an existing payment.**
`handleBookInvoice` (`App.jsx:4057`) runs `findDuplicate` and nothing else — there is no matcher on
the invoice rail at all.

Which means the books' final state depends on which document arrived first:

- **Invoice first** → `Dr Expense / Cr AP`; the bank line finds it open and clears it. **Correct.**
- **Payment first** → bank line finds no open item, books `Dr Expense / Cr Cash`; the invoice then
  arrives, finds no matcher, and books the expense **a second time**. **Wrong.**

The August drive hit the second order because Acts 2–3 were the bank statement and Act 4 was the
invoice pile. **That is not an unlucky fixture — it is the normal case.** A restaurant drops a month
of paperwork at once, and the bank statement is the document that already exists on a schedule while
the invoices are the pile on the counter.

> **THE CENTRAL REQUIREMENT OF THIS SPEC: the books must reach the same state regardless of the order
> the documents arrive in.** Everything below is downstream of that sentence, and §7 makes it a
> mechanical test rather than an aspiration.

---

## 1. THE CANONICAL MODEL

**Question asked:** *invoice creates AP and the bank line clears it, or the bank line is the payment
of an existing bill?*

**Answer: neither, as stated — because both presuppose the invoice arrives first.** The honest model
is one level up:

> **AN ECONOMIC EVENT IS BOOKED ONCE. A SECOND DOCUMENT DESCRIBING THE SAME EVENT IS EVIDENCE, NOT AN
> ENTRY.**

An accounts-payable balance is not a thing invoices create. It is **the representation of an
obligation that has not yet been settled.** If the settlement is already in the books, there is no
payable to create — creating one and immediately clearing it is a two-step no-op that exists only to
make the invoice feel like it did something.

That yields one rule with three cases:

| what we hold | AP created? | why |
|---|---|---|
| Invoice, no payment found | **Yes** — `Dr Expense / Cr AP` | A real unsettled obligation. This is what AP is for. |
| Invoice, payment already booked | **No** — attach to the existing entry | The expense is already recorded, at the right amount, on the right date. Nothing is owed. |
| Payment, no invoice | **No** — `Dr Expense / Cr Cash`, as today | Money moved and was recorded. The invoice is missing *documentation*, not a missing entry. |

**Today the app implements row 1 for every invoice unconditionally.** That single unconditional
default is the bug.

### 1.1 What "attach" means concretely

The bank entry is **already correct**. It has the right amount (the money that actually moved), the
right date (when it moved), and a booked account. The invoice adds things the bank line never had:

- the **document** itself, into the library, linked to the entry (closes the "No source document
  attached" gap the O83 doc-library item already tracks);
- the **invoice number**, the **invoice date**, the line detail, terms;
- possibly a **better account**, because an invoice says "CO2 tanks, bagged ice" while a bank
  descriptor says `ALAMO ICE BEV 4417`.

So attaching is not a no-op — it is strictly additive, and it is where the invoice's real value lands.
Two consequences worth stating:

- **The invoice's date does not move the entry.** The expense sits on the payment date. Changing it
  would move a booked transaction across a period boundary, and possibly into a signed month. The
  invoice date is recorded **as a field**, not as the entry date. *(A genuine accrual-timing question
  — a July invoice paid in August — is a period-cutoff decision and is explicitly out of scope; see
  §8.)*
- **A better account from the invoice is a RECODE, not a rebooking.** It goes through
  `persistRecode`, which already exists and is already audited.

---

## 2. THE INVOICE ARRIVES AFTER THE PAYMENT — THE COMMON CASE

**The invoice rail gains the matcher the bank rail already has, pointed the other way.**

Before booking, an invoice searches for an **already-booked settlement of itself**: a live entry, same
resolved vendor identity, same amount within a cent, within a window, that is cash-settled and not
already carrying an attached invoice.

Three outcomes:

1. **Exactly one candidate** → attach (§1.1). The owner is told what happened in one plain sentence,
   and it is a statement about the books, not a question.
2. **No candidate** → book to AP as today. Unchanged path.
3. **More than one candidate, or a near-miss** → §4, the ambiguity card.

**Reuse, do not re-implement.** The matching predicate must be **one function** used by both rails.
Two independently-written definitions of "same vendor, same amount" is precisely the ·3b(f3) failure
shape — two halves of one contract disagreeing about a format, shipped in the same commit — and it
is also how `anomalySubjectPeriod` and `anomalyTouchesPeriod` diverged. One matcher, both directions,
pinned by a test asserting they agree on the specimen set.

### 2.1 Vendor identity comes from C200, not from `normalizeName`

`autoMatchBankLines` currently normalises with `normalizeName` (strips `LLC`/`Inc`/parentheticals) and
then does **substring matching in both directions** (`bankMatch.js`): `iNorm.includes(partyNorm) ||
partyNorm.includes(iNorm)`.

**That is a merge rule, and it is looser than anything C200/C202 permits.** It is the same defect class
as the two over-matches my own directory seed shipped — `square` swallowing `SQUARE DANCE HALL`,
`sysco` swallowing `SYSCO FUEL` — which is why `MATCH_TYPE.EXACT` is now the directory default and
PREFIX is opt-in per row.

**Proposal: the invoice→payment matcher uses `identityForEntry` / `entityKeyFor` (`vendorIdentity.js`)
— the per-source strategy — and requires an EXACT entity-key equality.** The strategy table already
covers exactly the two rails in question: `bank_import` → RESOLVE (right half, rail-strip),
`universal_upload` → READ (left half, normalise only). This is the merge test that already ran on real
strings and came back **4 of 5** (§11, C201).

**And the 5th is Franklin Ave** — `FRANKLIN AVE PROPERTIES LP RENT` (bank) vs `Franklin Ave Properties
LP` (invoice) — **which is one of this drive's own specimens.** So under an exact-key rule, the
Franklin Ave pair does **not** auto-attach; it falls to §4 as an ambiguity, and a human confirming it
is precisely the `O111` per-company alias write-side that does not yet exist.

> **That is the correct outcome, not a gap.** Failing to attach parks and asks. Wrongly attaching
> suppresses a real second charge — silently, because a suppressed line leaves nothing on screen. The
> anti-merge asymmetry (Q4's one-way door) applies here exactly as it does to vendor identity, and
> **`O111` is on the critical path for the last mile of this feature but does not block its first
> 80%.**

**I do not propose loosening `autoMatchBankLines`' existing name rule in this work.** It is load-bearing
for the bank rail, it has been live and correct across eight drives, and changing it is a separate,
evidenced decision. Flagged here because the two rails will then use different name rules, which is a
real inconsistency and should be recorded as owed rather than quietly tolerated.

---

## 3. ONLY ONE SIDE EVER ARRIVES

**Bank debit, no invoice — this is normal and must stay silent.** The expense is booked and correct.
The only thing missing is documentation. It may feed a *document-collection* list; it must **never**
be an accounting exception, and it must never block a reconciliation. Most small-business spend never
produces an invoice the owner keeps.

**Invoice, never paid — this is a real open payable, and it is what AP is for.** It sits in
`matchableOpenItems`, ages, and appears in AP aging. Already works. **Nothing in this spec may make an
unpaid invoice harder to see** — that is the one direction in which the current unconditional-AP
behaviour is right, and the fix must not overshoot into "invoices don't create payables."

**The asymmetry is deliberate and worth stating:** an unmatched *payment* is silent, an unmatched
*invoice* is visible. Money that moved with no paperwork is a filing gap. Paperwork with no money is
an obligation.

---

## 4. THE ±$18 CASE — HILL COUNTRY 468.50 vs 486.50

**Recommendation: this is neither a partial payment nor a duplicate. It is an AMBIGUOUS PAIR, and it
is a card.**

A transposition and a genuine second charge are **externally identical**. `468.50` and `486.50` for the
same vendor four days apart is either a fat-fingered invoice, a fat-fingered bank feed, a short-pay, a
credit applied, or two real charges. **The system cannot tell, and must not pretend to.** Note the
detector's *current* behaviour: a 1% band on 468.50 is ±4.69, so at 18.00 apart this pair does not even
flag today — it is invisible in both directions.

Proposed handling:

- **Exact within one cent → auto-attach.** Same tolerance as `autoMatchBankLines` (`amountTolerance =
  0.01`). One rule, both rails.
- **Outside a cent but within a NEAR band → ambiguity card, never automatic, in either direction.** Not
  attached, not flagged as a duplicate, not booked to AP until answered.
- **Outside the near band → not a candidate.** Two unrelated charges.

**PARTIAL PAYMENT IS EXPLICITLY OUT OF SCOPE and must not be smuggled in here.** There is no
partial-clearing path in the codebase today — `autoMatchBankLines` is all-or-nothing and greedy
one-to-one, and `markBillPaid` clears the full bill amount. Building partial settlement is a real
feature with its own aging, its own `balance_remaining` semantics and its own tests. **Treating an
$18 discrepancy as an 18-dollar residual payable would be inventing a partial-payment model as a side
effect of a bug fix**, which is how the depreciation-schedule dead code and the normalised
reconciliation model both got built and never used.

**Open question I cannot settle alone — the NEAR band's width.** A percentage (say 5%) scales with the
charge, which is wrong in both tails: on a $12 charge it is 60¢, on a $12,000 charge it is $600. A flat
dollar band does not scale at all. A digit-transposition-aware rule (same digits, different order)
would catch Hill Country precisely and nothing else — **but it encodes a theory about the CAUSE, and
the card is forbidden from having one (§5).** Using it to decide *candidacy* while keeping the copy
causeless may be defensible; I flag it rather than choose. **Operator's call, and it is an accounting
judgment, not a threshold.**

---

## 5. WHAT THE CARD SAYS WHEN WE GENUINELY CANNOT TELL

**The standard is set, and it was set by this drive.** Act 7's two refusal cards state the arithmetic
and what the document says and **draw no conclusion about why** — no *"may be fraudulent"*, no
*"appears incorrect"*. That is Q9 doctrine in the highest-stakes copy in the product, and it is now
recorded in §11 as the reference. This card is written to the same standard.

**Proposed copy (ambiguous pair):**

> "This invoice from Hill Country Milling is for $468.50. On August 24 we recorded a payment to Hill
> Country Milling of $486.50 — $18.00 more. We can't tell from the documents whether these are the
> same purchase."

Every clause is checkable: two amounts we hold, one date we hold, one subtraction, and one statement
about **our own inability**, which is a claim about us and not about the world. No theory of the cause.

**Options — and the ordering rule matters as much as the wording.** Today the duplicate card leads with
**"New charge — book it"**, which is both the most prominent option and the one that corrupts the
ledger. **No card in this feature may lead with the destructive option**, and there must always be a
route that defers rather than forcing a guess:

- "Same purchase — attach this invoice to it"
- "Different purchase — record it separately"
- "Not sure — set it aside for my accountant"

**"Not sure" is not a courtesy, it is a correctness feature.** A forced binary on an unanswerable
question manufactures a wrong answer at a known rate, and the answer is a booking.

**And the plain no-candidate case is not a question at all.** When exactly one candidate matches to the
cent, the owner gets a statement: *"Filed this invoice with the payment we already recorded on August
3."* An owner who is told what happened can correct it; an owner who is asked a question they have no
way to answer learns to click the first button.

---

## 6. THE O88 CONNECTION — DOES A MATCH COUNT AS ATTESTATION?

**Recommendation: NO. Not as EXPLICIT, and I argue not at all. This is Amendment B's problem in a new
costume, exactly as suspected.**

The reasoning is one distinction:

> **AN ATTESTATION IS SCOPED TO THE QUESTION THAT WAS ASKED.**

Confirming *"these two documents are the same purchase"* is a judgment about **document identity**. It
is not a judgment about **which account this vendor's charges belong in**. A human can be certain the
Franklin Ave invoice and the Franklin Ave bank line are one event while having no opinion whatsoever
about whether it belongs in Rent or Occupancy — and in the common case they never even see the
account, because attaching does not change it.

That is precisely the shape Amendment B already ruled on: **signing a month is not examining a vendor.**
Matching an invoice to a payment is not attesting its classification. Same rule, second instance —
which is itself evidence the rule generalises rather than being a patch on one case.

**The concrete hazard, stated plainly.** `attestationStrength` (`vendorBackfill.js:42`) grades an
observation EXPLICIT if `exception_resolved || recoded`. **An ambiguity card is an exception, and
resolving it sets exactly that field.** So without a deliberate exclusion, answering "same purchase"
would mint an EXPLICIT attestation — and Amendment B's bar is **≥1 explicit**. A vendor would graduate
to KNOWN on **paperwork volume**, and its `attested_account_id` would be whatever the machine happened
to book. **That is the machine attesting to its own guess through a human's click on an unrelated
question** — Amendment B exists to prevent exactly that, and this would route around it within one
release of it being signed.

**Proposed rule:**

- A match/attach event is **its own fact class**. It may be recorded on the entry. It does **not**
  enter `vendor_state.observations` as an attestation of the account.
- If it is recorded as an observation at all, it is **IMPLICIT** — pattern data (amount, cadence,
  identity co-occurrence) which never graduates anything, per Amendment B §3.
- **A test must pin it**, in the file a falsifier would open — `tests/vendorBackfill.test.js` or
  `tests/vendorTier.test.js`, **not** in the new matching suite. The ·3c review bounce is the lesson:
  the null-net pin existed, passed under mutation, and lived in a file nobody doubting the matcher
  would ever run. **Proofs live where a falsifier would look for them.**

**One case genuinely does attest, and it should be kept separate.** If resolving the card also
*recodes* the account — the invoice line detail reveals the bank descriptor was booked wrong — **that
is a real explicit attestation of the mapping**, because a human looked at the account and changed it.
The attestation attaches to the **recode**, not to the match. Two events, two facts, and only one of
them touches the familiarity clock.

---

## 7. ACCEPTANCE — HOW WE KNOW IT WORKS

**The primary test is order-independence, and it is mechanical.** For each specimen pair below: book
invoice-then-payment, record the trial balance; reset; book payment-then-invoice; **assert the two
trial balances are identical.** One number, no judgment, and it fails loudly on exactly the bug that
produced this spec.

**Specimens, from this drive** (all four currently produce a false `duplicate_payment` card):

| vendor | invoice | payment | expected |
|---|---|---|---|
| Franklin Ave Properties | Aug 1 | Aug 3 | ambiguity card — entity keys differ (§2.1); auto-attaches once `O111` lands |
| Roma Cheese & Dairy | Aug 4 | Aug 4 | auto-attach, exact |
| Toast | Aug 21 | Aug 21 | auto-attach, exact |
| Alamo Fire & Safety | Aug 20 | Aug 24 | auto-attach, exact |
| Hill Country Milling | 468.50 | 486.50 | ambiguity card (§4); **never** silent, in either direction |

**Explicit non-goals, so a green suite cannot be read as more than it is:**

- **`account_materialized` stays at 0** across the whole run. Nothing in this feature may reach
  `ensureAccount` or the `DEFAULT_BY_ROLE` absorber.
- **No signed month is written to.** Attaching to an entry inside a signed period is refused, the way
  `markBillPaid` already refuses (`App.jsx`, signed-period guard).
- **`7100` gains no lines.** TIER 1 #7's hard fail is unaffected by this work.
- **Assert the mechanism FIRES, not that nothing is outstanding.** A run where nothing matched and a
  run where matching is broken produce the same clean queue — that is the C195(7) lesson, where a
  block never executed for a whole release because its input array was always empty. The test asserts
  a specific count of attachments, not the absence of flags.

### 7.1 What this spec does NOT fix, said out loud

**`O114` as filed contains two distinct defects, and this spec addresses one.** The Bluebonnet false
positives — four cards against last month's identical $145 — are **not** the lifecycle bug. Bluebonnet
is a weekly fixed-fee vendor at exactly 7-day spacing, and the detector's window is `gapDays <= 7`, so
a legitimately weekly charge lands **exactly on the boundary** every single week. Same-vendor-same-amount
is the *normal* case for that vendor, and no amount of invoice-to-payment matching changes it.

**That is the pattern-level suppression item already on the backlog** (recognise a vendor as
legitimately recurring at a cadence via `detectRecurringPatterns` / `recurring_transactions`, and
exclude its on-cadence charges from duplicate detection). It should be fixed *with* this work, since
both land in the same detector and the operator will otherwise reasonably read "O114 fixed" as "the
Bluebonnet cards are gone." **They will not be.** Recorded here so that cannot happen quietly.

---

## 8. OUT OF SCOPE — named so they are declined, not forgotten

- **Partial payments / short-pays** (§4). No path exists; building one here would be a side effect.
- **Accrual timing across a period boundary** (a July invoice paid in August). A cutoff decision with
  real GAAP content, and it interacts with `period_signoffs`. Separate.
- **Loosening `autoMatchBankLines`' name rule** (§2.1). Live and correct for eight drives; changing it
  needs its own evidence.
- **`O111`, the per-company alias.** On the critical path for the Franklin Ave last mile; not a
  blocker for the rest. Already sequenced with C202.
- **A/R — the customer side.** Structurally the mirror of this, and `buildPaymentEntry` already handles
  both sides. Deliberately not specified here: A/R deposits arrive batched and short-paid far more often
  than A/P, so the mirror is not as clean as it looks and should not be assumed.

---

## 9. OPEN QUESTIONS FOR THE OPERATOR

1. **§4 — the NEAR band.** Percentage, flat dollar, or transposition-aware? The last one catches Hill
   Country precisely but encodes a theory about the cause; I flag rather than choose.
2. **§1.1 — a better account from the invoice.** Auto-recode, or propose and ask? Auto is friendlier;
   asking is consistent with "the machine may recognise, not decide." I lean **propose-and-ask on a
   changed account, silent on an unchanged one**, but it is an accounting-authority call.
3. **§3 — the document-collection list.** Should a payment with no invoice ever be surfaced at all, or
   is that a Tier 3 filing feature? It is one query either way; the question is whether it earns a
   surface.
4. **§7.1 — is Bluebonnet in this batch or the next one?** Fixing it here means touching cadence
   detection; deferring it means the drive's most-repeated card survives a release that claims to have
   fixed the detector.

---

**STATUS: DRAFT. NOT SIGNED. NOTHING BUILT.**
