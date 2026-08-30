# The flat-fee recurring vendor — design spec for `O117` + `O127`

**Status: BUILT 2026-08-29 (matching half). Detection half (§7) NOT built.**
Design session + implementation, same day, on the operator's instruction ("build it").

Signed: `[ ]` Alex (CPA) — date: ________

> One document because `O117` and `O127` are **one property surfacing in two subsystems**.
> They were split on 2026-08-26 as different failure modes of the duplicate detector, and
> the 2026-08-27 re-drive proved that wrong: the same fact about the vendor produces a
> noisy card in the detector and a silent wrong booking in the matcher. Designed apart they
> would grow two independent notions of "recurring", and the next symptom would get a third.

---

## 0. The property

> **For a flat-fee recurring vendor, amount and identity carry no information.**

Bluebonnet Linen bills **$145.00 every week**. Vendor is constant. Amount is constant to
the cent. So every axis the system normally reasons from is the same on every document,
and **any decision it reaches is being made by whatever variable is left over** — which
today is a date window chosen for something else.

This is not a tuning problem. It is a problem of **the discriminator being absent**.

---

## 1. What the code actually does (established, not recalled)

### 1.1 The matcher — `settlementCandidates` / `planInvoiceArrival`

```
WINDOW_BEFORE_DAYS = 7      WINDOW_AFTER_DAYS = 60
gap = dayGap(invoice.date, entry.date)
if (gap < -WINDOW_BEFORE_DAYS || gap > WINDOW_AFTER_DAYS) → excluded
…
certain = candidates where identity EXACT and amount EXACT
if (certain.length === 1) → ATTACH
```

August's Bluebonnet invoice is dated **08-03**. The four July payments are **07-06, 07-13,
07-20, 07-27**, all $145.00, all identity-exact, all amount-exact:

| payment | gap | in window? |
|---|---|---|
| 07-27 | −7 | **yes — exactly on the boundary** (`-7 < -7` is false) |
| 07-20 | −14 | no |
| 07-13 | −21 | no |
| 07-06 | −28 | no |

Exactly one candidate survived, so `certain.length === 1`, so **ATTACH**.

> ### The certainty was manufactured by the window, not found in the evidence.
> At ±14 the same code would have asked. At ±3 it would have booked a payable. **Nothing
> about the two documents decided it.** And it failed **silently**: the 08-03 delivery's
> expense is suppressed, the 07-27 payment is claimed by an invoice that is not its own,
> and nothing on any screen says so.

### 1.2 The detector — `findDuplicate`

Keys on normalised vendor + amount within 1% inside a date window. A vendor charging the
same amount every week trips it **every week, by construction** — four cards for Bluebonnet
in August alone.

### 1.3 What we already hold

`vendor_state` (migration `064`, live, currently 0 rows) carries `amount_mean`,
`amount_sd`, `observation_count`, `distinct_months text[]`, `first_seen`, `last_seen`.
`amountBand()` already derives mean/σ with a 5% floor.

**So the recognition half needs no new data and no migration.** See §5.

---

## 2. Why no threshold works — the constraint, with its reasoning

**▶ EXPLICIT CONSTRAINT (operator, 2026-08-27): DO NOT TUNE THE WINDOW.**

- **Widen it** → more candidates survive → more `MULTIPLE_CANDIDATES` cards → more noise on
  a vendor that already generates too many.
- **Narrow it** → no candidate survives → a payable is booked for a bill already paid →
  the expense is double-counted, which is `O114`'s original bug.
- **Neither adds a bit of information.** The two documents remain indistinguishable on
  every axis the matcher reads.

Tuning converts a diagnosable failure into a quieter one. That is strictly worse: the
current failure at least happened on a boundary we could point at.

---

## 3. The reframe — the pair is the wrong unit

Ask what actually goes wrong when invoice A attaches to payment 3 instead of payment 1,
given all four are $145.00 from the same vendor.

**Within one accounting period: nothing.** Every account balance, every total, every
control figure is identical. The pairing is **unobservable in the books**.

**Across a period boundary: the expense moves months.** That is exactly the `O127` damage —
August is short a $145 delivery because its invoice attached to a July payment.

> ### So the question the matcher was asking — *"which payment does this invoice belong
> to?"* — is (a) unanswerable from the data and (b) mostly not worth answering. The
> question that matters is **"does this vendor's period balance?"**

That is also what a competent bookkeeper does. Handed four identical invoices and four
identical payments, nobody agonises over the pairing. They check that **four is four**, and
what they catch is *five invoices against four payments* — one delivery unpaid.

**The right unit is the SET, not the pair.**

---

## 4. Honest about what this does not make perfect

Set-matching leaves one real residue, and it should be written down rather than discovered
later: **the document filed against a given payment may be the wrong week's PDF.** An
auditor pulling support for the 07-27 payment could get invoice `BLS-88412` instead of
`BLS-88109` — both Bluebonnet, both $145.00, different invoice numbers.

This is a genuine imperfection. It is accepted because:
- every figure in the books is correct, which is not true today;
- the alternative designs (§8) are worse on the axis that matters more;
- it is **visible** — both documents are in the library, attached to the right vendor and
  the right period — where today's failure is invisible.

**If the payment descriptor ever carries a reference number, use it and skip all of this.**
It rarely does on ACH; that is the whole reason we are here.

---

## 5. Recognising the class

A vendor is **FLAT-FEE RECURRING** for a period when all three hold:

| test | from | rationale |
|---|---|---|
| **flat** — `amount_sd / amount_mean ≤ 0.02` over ≥ 4 charges | `amountBand()` | the amount carries no information |
| **frequent** — more than one charge per period on average | `observation_count / distinct_months.length` | a vendor billing once a period has an unambiguous pairing already; leave it alone |
| **established** — ≥ 4 charges (**≥ 1 period — see below**) | `observation_count` | two data points are a coincidence, not a cadence |

> **★★ AMENDED DURING THE BUILD, BY A FAILING ACCEPTANCE CRITERION.** This originally read
> "≥ 2 periods". §1's third criterion — *an August invoice must not reach a July payment
> even when August has no payments at all* — **failed against it**: with only July in the
> ledger the class went unrecognised, the invoice fell through to the pair rule, and it took
> the 07-27 payment. **The recognition bar was re-opening the exact bug it sits in front
> of.** The deciding argument is that the two errors are not symmetric — recognising too
> eagerly declines a cross-period attach and books a visible payable; recognising too late
> is the silent cross-period attach. The bar belongs on the side that fails loudly.

**★ ALL THREE ARE DERIVABLE FROM BOOKED LEDGER ENTRIES DIRECTLY, so this must NOT depend on
`vendor_state` being populated.** `vendor_state` is live but empty — Amendment B withholds
every backfill tier and `C201` is on hold. Wiring recognition to it would park this fix
behind `O102`, which is the largest item on the board. Compute from the ledger; read
`vendor_state` later as an optimisation if it ever helps.

**★★ AND THE CLASS DEFINITION AND THE RULE CHANGE ARE ONE DECISION.** Only vendors charging
*more often than the period* get set-reconciliation. A net-30 vendor bills once a month, has
one plausible payment, and keeps today's behaviour unchanged. This is what keeps the blast
radius to the population that actually has the problem.

---

## 6. The rule — matching (`O127`)

For an arriving invoice whose vendor is FLAT-FEE RECURRING **in the invoice's own period**:

1. **Do not choose a pair on date proximity.** The window stops being a discriminator for
   this class. It is not widened, narrowed, or consulted.
2. Count, within the invoice's period, for that vendor:
   - `payments` — cash-settled entries at the flat amount, live;
   - `claimed` — those already carrying an attached invoice;
   - `invoices` — arrived invoices at the flat amount, this one included.
3. **If `invoices ≤ payments`** → attach to any unclaimed payment in the period, and record
   `pairing: "set"` on the link so nothing downstream believes a precision that was never
   established. **No card.** The books are right and the pairing is arbitrary-and-known-to-be.
4. **If `invoices > payments`** → this delivery has no charge behind it → **book the
   payable** (the normal unpaid-bill path) and raise **one** card for the period:
   *"We have 5 Bluebonnet invoices for August but only 4 payments — one looks unpaid."*
5. **If the invoice's period has no payments at all** → book the payable. Unremarkable.

**Nothing in this rule can silently drop a delivery**, because step 2 counts both sides and
step 4 is the only path that books nothing new.

### 6.1 The period

The **accounting month** — the unit the books are already organised in and the unit
sign-off attests. **This is deliberately not a tunable knob**, which is the point: the one
number in the old design that could be argued about is replaced by a boundary the product
already has a meaning for.

---

## 7. The rule — detection (`O117`)

For the same recognised class, `findDuplicate` **stops firing on the normal case**: a
vendor charging its usual amount on its usual cadence is the definition of expected, and a
card the user sees every week is, by `O122`, a defect rather than a question.

**★ BUT SUPPRESSION IS NOT BLANKET, AND THIS IS THE LOAD-BEARING HALF.** What must still
fire is a **count** anomaly, not a **pair** anomaly:

> *"Bluebonnet charged 6 times in August; they normally charge 4."*

Same reframe as §3 — count, not pair. A genuine double-payment still surfaces, because it
shows up as a count above the cadence. What disappears is the weekly card that says two
identical charges happened, which they are supposed to.

---

## 8. Alternatives considered, and why not

| option | verdict |
|---|---|
| **Invoice number** (`BLS-88412`) | **Does not solve `O127`.** It identifies the *invoice*; the **payment** — an ACH bank line — carries no invoice number, so it cannot link the two. It *would* help `O117` (two invoices with different numbers are not duplicates) and should be used there where present. Recorded because it reads like the obvious answer and is not. |
| **Sequence / Nth-to-Nth** | **Rejected.** Requires completeness on both sides; one missing invoice shifts every subsequent pairing **silently**, which is precisely the failure mode being escaped. Trades one invisible error for a compounding one. |
| **Delivery/service date on the document** | Doesn't help. The payment still carries only its own date. |
| **Detect the class and ALWAYS ASK** | **Rejected on the product's own criterion.** Honest, but one card per delivery = a weekly card forever, and `O122` states that a card you see every period is a bug wearing a question mark. It fails the acceptance test this product wrote for itself. |
| **Don't match at all** | **Rejected — it is `O114`.** The bank line already booked the expense; the invoice books it again; the P&L double-counts. |
| **Tune the window** | **Rejected by standing constraint** (§2), and on merit: no threshold adds information. |

---

## 9. Acceptance criteria — written BEFORE the data

> Pre-registered per `O127`'s own lesson: the over-match was caught only because §2 of the
> re-drive criteria named a specific vendor and a specific *direction of surprise* before
> the run. **A missing card is harder to notice than a wrong one, because absence has no
> pixel.**

**§1 — the silent failure is gone.** Bluebonnet's August invoices attach only to August
payments. Specifically: `BLS-88412` (08-03) must **not** attach to the 07-27 payment.
Attaching it again is a **hard fail**.

**§2 — the noise is gone.** A normal Bluebonnet month produces **zero** cards. Four
invoices, four payments, four expenses booked, no questions.

**§3 — ★ THE ANTI-VACUITY CHECK. Suppression must not become blindness.** Feed a month with
**five** payments and four invoices. It must raise **exactly one** card naming the count.
**If that card does not appear, the fix is worse than the bug** — it will have made a real
double-payment invisible, which is the single most likely way a wrong implementation looks
better than a right one.

**§4 — the class boundary holds.** A monthly net-30 vendor (Franklin Ave rent) must behave
**exactly as today**. Any change in its behaviour means the class test is too wide.

**§5 — the books.** For any Bluebonnet month, expenses booked = charges on the bank
statement. Not one more, not one fewer.

**§6 — card rate (`O122`).** Report the count **split by category**, not as a total.
Expected steady state for this vendor: **category 1 = 0, category 2 = 0, category 3 = 0.**

---

## 10. What this explicitly does not solve

- **Which delivery a given invoice documents.** Unanswerable from the data (§0) and, within
  a period, not worth answering (§3). The residue is named in §4.
- **A flat-fee vendor whose amount changes.** A price rise makes the amount informative
  again and the vendor leaves the class on its own — that is the class test working, not an
  exception to it.
- **`O102` / confidence calibration.** Untouched, and deliberately not depended on (§5).

---

## 11. Migration

**None.** Recognition is derived from booked entries; `pairing: "set"` is one more key in
the `import_metadata` object the attach path already writes.

> ⚠ **`import_metadata` is written by a FOLLOW-UP `checkedRowUpdate`, never through
> `p_meta`.** `post_journal_entry` cherry-picks six named scalars and discards everything
> else (`O95`) — the defect that made the payroll gate inert for a release and let one
> invoice be reversed three times. The `O114` attach path already does this correctly;
> the new key rides along with it and adds no new write.
