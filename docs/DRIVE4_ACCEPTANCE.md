# FOURTH RED RIVER DRIVE — ACCEPTANCE CRITERIA

**Written 2026-09-12, BEFORE the drive.** Fixed in advance so the result cannot be read either way
afterwards. Every criterion is binary and names what a failure means — and, where a pass could
arrive for the wrong reason, names the wrong reason.

Twenty-two commits shipped between the third drive (2026-09-10) and this document (C324–C345).
Most were found by asking *who reads this?*; none has been driven live. This is their test.

---

## 0. PRECONDITIONS — WITHOUT THESE THE DRIVE PROVES NOTHING

**0.1 ★ THE BUILD IS THE CURRENT ONE.** The second drive scored a stale build for twenty minutes
(`C310`). Before dropping anything, open Reports: the line under the title must read
*"No month has been signed off yet…"* or *"Reviewed and signed off through …"* (`C343`). If that
line is absent, the app is serving an old bundle — stop.

**0.2 ★ A FRESH COMPANY, OR THE RESIDUE NAMED.** The third drive's 28 documents are stored unlinked
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

## SCORING

Report each criterion as **PASS / FAIL / NOT EXERCISED**, with the wrong-reason check written next
to every PASS. A criterion that could not be exercised is reported as such — never folded into a
pass. The operator rubric (Q1–Q5) follows, and Q2 (*"did the system assert something false about
the world?"*) is read against every sentence on Review and the queue, as on drives one to three.
