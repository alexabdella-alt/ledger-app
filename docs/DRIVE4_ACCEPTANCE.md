# FOURTH RED RIVER DRIVE — ACCEPTANCE CRITERIA

**Written 2026-09-12, BEFORE the drive.** Fixed in advance so the result cannot be read either way
afterwards. Every criterion is binary and names what a failure means — and, where a pass could
arrive for the wrong reason, names the wrong reason.

Twenty-two commits shipped between the third drive (2026-09-10) and this document (C324–C345).
Most were found by asking *who reads this?*; none has been driven live. This is their test.

> **★★ UPDATED 2026-10-01 — READ §14 FIRST.** The drive has still not been run, and ~200 commits
> have shipped since this was written. §14 is the run sheet (fresh company, two batches) and the
> criteria added for what shipped since. **The invoice pile was also regenerated (C552)**: the old
> generator was not reproducible and the linen supplier it planted as the flat weekly fee was never
> actually flat, so three drives ran without that case in the pile. Regenerate before running:
> `python3 tools/makeInvoiceImages.py`. The pile drives 1–3 used is kept in
> `tools/drive-fixtures-drives1-3/`.

---

## 0. PRECONDITIONS — WITHOUT THESE THE DRIVE PROVES NOTHING

**0.1 ★ THE BUILD IS THE CURRENT ONE.** The second drive scored a stale build for twenty minutes
(`C310`). Before dropping anything, open Reports: the line under the title must read
*"No month has been signed off yet…"* or *"Reviewed and signed off through …"* (`C343`). If that
line is absent, the app is serving an old bundle — stop.

**0.2 ★ A FRESH COMPANY — NOW REQUIRED, SEE §14.0.** *(The original text follows; the residue route
no longer applies, because the regenerated pile is billed to a different company name.)*
**A FRESH COMPANY, OR THE RESIDUE NAMED.** The third drive's 28 documents are stored unlinked
(`O136`). On the same company, every "no source document" you see on a pre-2026-09-11 entry is that
residue, not a failure of `C324`. Either run on a fresh company, or run
`supabase/verify/O136_repair_from_upload_log.sql` (a) first and note the verdict counts.

**0.3 ★ ANSWER SABINE.** *"Business use, and I'll use it more than a year."* The `C309` criterion
(§4) cannot be scored until that card is answered; the third drive's zeros were partly "less
happened" because seven cards sat unanswered.

**0.4 AI BUDGET.** 35 documents is 105 calls on a fresh read; `087`'s 300/hour holds it. On a
RE-DROP of the same files the count should be ~35 lower (`C329`, §7) — which is itself a criterion.

---

## 1. THE DOCUMENT IS ON THE TRANSACTION (`C324` / `C325`)

1.1 Open any entry booked from THIS drive in Transactions. The SOURCE DOCUMENT box shows the
file — a thumbnail or a filename, not *"No source document attached."*
**Fail = every entry from this drive still says "no source document" — `O136` is not fixed.**
**Wrong-reason pass:** an entry from BEFORE this drive showing a document is the residue repair
(0.2), not `C324`.

1.2 On ONE pre-drive entry with no document, press **Upload** and drop the same PDF again. The box
must then show it, the Documents tab must NOT gain a second copy of the file, and Transactions must
NOT gain a second booking.
**Fail (a) = a duplicate document — dedupe broke. Fail (b) = a second booking — the attach button
is booking, which it must never do. Fail (c) = "attached ✓" and nothing changed — `C325` did not
gate the sentence on the record.**

1.3 Anti-vacuity: at least one document in this drive covers TWO invoices (Sysco, dates 7 and 21
if they arrive as one PDF; otherwise skip). The document links to the FIRST booked entry only;
the second entry's box says no document. **That is the recorded limit (`jeIds[0]`), not a
failure — but it must be the second entry, never the first, and never both empty.**

## 2. THE DOCUMENT SAYS WHICH ENTRY IT BECAME (`C326`, `C337`)

2.1 Documents tab, any invoice from this drive: the card reads *"<Vendor> · $<amount>"* and offers
*"Open the transaction →"*, which opens the same entry 1.1 showed. Round-trip must land on the
same row both ways.

2.2 The card's date is the **invoice date printed on the document**, not the upload day, with no
*"uploaded"* prefix. **Fail = "uploaded Sep 12" on a file whose invoice date is in August —
`C337`'s stamp did not land.** Check the bank statement too: its date must be the period end.

## 3. THE ACCURACY LINE (`O134` / `C311`)

Review must show **NO** `docs_recorded` accuracy flag for this drive's documents — and not by
counting fewer documents. Open the completeness net: it must report every document from this drive
as accounted for, each intake row **recorded with a link**.
**Fail = "N of M documents has no entry behind it" → C311's ids did not thread.**
**Wrong-reason pass:** the line absent because the completeness net did not RUN (the `C308` shape).
Confirm it printed a count.

## 4. THE A/P TIE HOLDS WITH SABINE ANSWERED (`C309`)

After 0.3, Sabine posts `Dr Fixed Assets / Cr A/P`. Review's `ap_tie` must TIE — open bills must
include the $4,625.00 freezer.
**Fail = "off by $4,625.00" — a fixed-asset debit is still invisible to open bills.**
**Wrong-reason pass:** Sabine answered "expense" instead — then it is an ordinary bill and the
criterion was not exercised. Answer it as stated.

## 5. SALES TAX (`C305`)

The fixture has no sales; `sales_tax_tie` must be **silent**. **Fail = "tax charged on invoices is
$X, sales tax owed is $0.00" on a purchase-only month — tax we PAID is being counted as tax we OWE.**

## 6. THE ANOMALY POINTERS SURVIVE A RELOAD (`C307`)

Reload the app. Every anomaly card that names a transaction must still resolve it — no *"1 of 1
linked entry can no longer be found"*. **Fail = any such line after reload.**

## 7. THE EXTRACTION IS READ ONCE (`C329`)

Drop the SAME invoice a second time (choose one that booked cleanly). The queue line must read
*"We'd already read <file>, so we reused it…"* and the entry must NOT book twice (the duplicate
guard still runs — that is a separate card, or `C310`'s deferral).
**Fail (a) = no reuse sentence and three AI calls spent — the cache did not hit. Fail (b) = a second
booking with no card — the coding step was skipped, which `C329` must never do.**

## 8. THE FLAT-FEE COUNT CARD — THE ANTI-VACUITY CHECK (`C332`)

Bluebonnet is weekly at a flat amount. If the bank statement carries FOUR Bluebonnet charges and
FIVE invoices arrive (drop one twice as a distinct file, or add a fifth), Review must show **exactly
one** *"more invoices than payments this period"* card naming *5 invoices … 4 payments*.
**Fail = no card — the spec's own §3 says that state is worse than the bug.**
**Wrong-reason pass:** two cards (one per extra invoice) — the fingerprint is not per-period.
If the statement has five Bluebonnet charges instead, this criterion is NOT exercised; say so.

## 9. THE QUESTION COUNT (`C334`)

Review's sign-off card shows *"Questions asked · 2026-08 — N cards across M documents (…)"*.
Record N, M and the split. **Fail = the line absent, or "not classified" with a count > 0** — a
card kind the taxonomy does not know reached the product. **Compare N to the third drive's 7.**

## 10. THE SWEEP OFFER (`C339`)

Open one Sysco entry, change its category. The panel must ask *"Also change the other N Sysco
entries to <category>?"* with *No, just this one*. Press **No**: exactly one entry changed. Open a
second Sysco entry, change it, press **Yes**: every remaining Sysco entry on the old category
changes, and the audit trail carries ONE `recode_sweep` row with the count.
**Fail = no offer on a supplier with other entries; or Yes changes entries of a DIFFERENT supplier.**
(No month is signed on this company, so the *"…signed off and stay as they are"* clause must be
ABSENT — its presence would be a wrong count.)

## 11. THE PANEL READS PLAINLY (`C330`)

The slide-in shows *Category · Against · How sure we were · WHY IT WAS BOOKED THIS WAY · Change
category*. **Fail = "GL account", "Offset account", "AI confidence" or "Recode" anywhere on it.**
And a payment/clearing entry shows NO reasoning box at all (`C328`).

## 12. CREEP — NOT EXERCISABLE HERE, SAY SO

`C344` needs three signed months; this company has none. By Vendor must read *"We need three
signed-off months before we can say who's charging more than usual."* — **the honest absence, not
a blank.** A vendor named here on an unsigned company is a FAIL.

---

## 13. THE OWNER'S FIGURES AFTER 2026-09-15 (`C437`–`C454`) — ADDED AFTER THE DOC WAS WRITTEN

Four figure defects shipped on 2026-09-15 that a drive can check in minutes. Each is binary.

- **13a — Reports, first of the month (`C440`).** Book (or find) an entry dated the **1st** of the current month. Open Reports → *This month*. **PASS** if it is in the month; **FAIL** if it sits in *Last month*. Wrong-reason pass: a machine in UTC cannot fail this — check from a US-zone browser.
- **13b — Customers, "Still owed to you" (`C452`/`C454`).** A customer whose sale arrived as a **bank deposit** (card payment) shows **$0.00** owed; a customer with an **issued invoice** carrying sales tax shows the **taxed** total. Wrong-reason pass: a company with no deposits proves nothing on the first half — Red River has Toast payouts.
- **13c — Vendors, "Bills you still owe" / "Paid YTD" (`C453`).** A supplier paid at the till (a bank-line purchase) shows **Paid YTD > 0 and Owed $0.00**; a supplier with an open uploaded bill shows the bill under owed. Wrong-reason pass: a supplier with both kinds must show both halves right.
- **13d — The invoice email (`C437`/`C450`/`C451`).** Send an invoice with a sales-tax rate and **no due date typed**, terms Net 30. The email body says **"for <taxed total>"** and **"Total due: <taxed total>"**, the printed invoice's *Due Date* is issue + 30 days (not *On Receipt*), and the sent-invoice list shows the taxed total. Wrong-reason pass: an invoice with no tax cannot fail the total half.

---

## 14. THE RUN SHEET, AND WHAT SHIPPED SINCE (`C346`–`C551`) — ADDED 2026-10-01

### 14.0 Setting up — in this order

1. **Regenerate the pile:** `python3 tools/makeInvoiceImages.py`. Then open `ANSWER-KEY.txt` and
   check the four Bluebonnet totals all read **$145.00**. If they don't, you have the old pile — stop.
2. **Create a new company named exactly `Riverbend Pizza Co.`** The invoices are billed to that
   name, and the bill-to is how extraction tells which side of the bill we are on. A different
   name will turn every bill into a "did you pay this or receive it?" question.
3. **Onboarding:** business type **Restaurant** (gives it a Food Cost category), one real bank
   account, and starting balances with **Day One = 2026-08-01** and any non-zero cash (e.g.
   $25,000). Every invoice is dated August 2026; a Day One after Aug 1 refuses the early ones.
   *Do not invite an accountant* — §14e needs a company with none.
4. **Drop in two batches.** **Batch A = files `01`–`10`** (Aug 1–8, one of each weekly supplier).
   **Answer every question card it raises.** Then **batch B = files `11`–`35`.**
   *Why two batches:* dropped all at once, every Alamo Ice invoice is read before you have answered
   anything, so "does it stop asking once you've told it" (§14b) cannot be observed at all.
5. The August bank statement from the earlier drives lives outside the repo. Drop it **after**
   batch B if you have it — §5, §8 and §13b–c need it. It names the old company; if that confuses
   it, mark those **NOT EXERCISED** rather than failed.

### 14.1 Criteria

- **14a — The flat weekly fee is not a duplicate (`O117`/`O127`, `C220`).** After batch B, there is
  **no open card** calling Bluebonnet Linen a possible double payment or "charged twice".
  **Fail** = such a card is open at the end. *A card that appeared after batch A (two of the four
  in) and is gone after batch B is acceptable* — four identical bills is the bar for "flat"; note it
  if you saw it. **Wrong-reason pass:** the four totals are not all $145.00 (see 14.0 step 1).

- **14b — How fast it stops asking, measured against the rule AS BUILT (`O64`).** The rule today:
  **the app trusts a supplier once it has two bookings on record. Your answer to a card counts as
  one. Changing the category on an entry (a recode) teaches it immediately.** So if batch A asked
  about Alamo Ice (Aug 6) and you answered, batch B's Aug 13 Alamo **may** ask again — and batch B
  is read in one go, so Aug 13 / 20 / 27 may all see the same one-booking history.
  **Record which Alamo dates asked, in each batch.** **Fail** = an Alamo invoice asks when two Alamo
  bookings already existed before its batch was dropped, or any Alamo bill lands in Miscellaneous.
  *Three Alamo questions in batch B is the rule working as built — and it is the open product
  question in C552's note (should one answer be enough?). Score it as RECORDED, not as a pass.*

- **14c — Nothing is filed while its own explanation says it belongs elsewhere (`C551`).** For
  every entry that booked **without** a question, open it and read *Why it was booked this way*.
  **Fail** = the explanation says the bill belongs in a different category from the one it was
  filed under (the Lone Star → Travel & Entertainment shape). At minimum read the Alamo, Corner
  Market, Lone Star Restaurant Supply, Travis County and Waterloo entries.
  **And** on any question card, if the card offers a one-tap *"It was …"* answer, that answer must
  not be a category the card's own text casts doubt on.

- **14d — The 1099 tracker shows August's suppliers (`C549`).** Taxes → *Open 1099 tracker*: the
  heading reads **2026**, and the suppliers you paid in August are listed under *Vendors paid in
  2026*. **Fail** = it reads 2025, or *"No vendor payments recorded for 2025 yet."* The Taxes card's
  sentence names the same year (*"…for 2026"*).

- **14e — The screens don't claim a reviewer you don't have (`C550`).** With no accountant invited,
  the Taxes footer reads *"Nobody is reviewing your books yet — add your accountant under Settings
  → Team…"*. Settings → Team's heading names three choices and does not say "members".
  **Fail** = *"CFAI advisor"* or *"reviews your books monthly"* anywhere.

- **14f — Ordinary bookings still save under the new database rules (`091`/`092`).** Every one of
  the 35 that books does so with **no** *"couldn't save"* error. **Fail** = any save error, above all
  one mentioning a category or a different company — that would be the new tenancy keys refusing
  an ordinary booking (the `079` direction, live).

- **14g — Chat recode on a real entry (`C546`).** In the chat: *"Move the Corner Market receipt from
  Aug 8 to Office Supplies."* **Pass** = that one receipt moves and nothing else does.
  **Fail** = it reports success and nothing moved, or it moves a different entry, or it says
  *"check your connection/permissions"* (that sentence no longer exists).

- **14h — The pile fits in the budget (`087`).** All 35 are read without a "limit reached" message.
  **Fail** = a limit message before 35 — the deployed limit is not the one the repo says (100
  files / 300 AI calls an hour), which is a finding about the live function, not the app.

## SCORING

Report each criterion as **PASS / FAIL / NOT EXERCISED**, with the wrong-reason check written next
to every PASS. A criterion that could not be exercised is reported as such — never folded into a
pass. The operator rubric (Q1–Q5) follows, and Q2 (*"did the system assert something false about
the world?"*) is read against every sentence on Review and the queue, as on drives one to three.
