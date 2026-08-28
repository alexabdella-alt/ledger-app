# WHAT A FIRST PAYING CLIENT WOULD HAVE TO BE TOLD

**Living artifact. Each line names the ledger item that closes it, so this list SHRINKS VISIBLY as
work lands.** Started 2026-08-27.

**The rule for this file: a thing belongs here if we would have to say it out loud to someone
paying us.** Not "a known issue" — a *disclosure*. If we would be uncomfortable saying it after
they found it themselves, it goes here.

**Nothing is removed until the closing item is verified in a drive.** Marked ✅ + the commit.

---

## A. THE BOOKS CAN BE WRONG IN WAYS THEY CANNOT SEE

*The most important section, because everything in it is silent.*

| # | what we would have to tell them | closes with |
|---|---|---|
| **A1** | **"A supplier who bills you the same amount every week can have an invoice matched to the wrong week's payment. When that happens one delivery quietly stops being an expense, and nothing on screen says so."** Weekly linen, weekly produce, weekly laundry — the vendor class a restaurant has most of. | **`O127`** (+`O117`) |
| **A2** | **"If you press Void twice, we book the reversal twice. There is nothing stopping it and no accounting reading under which it is correct."** | **`O123`** |
| **A3** | **"A charge from a supplier we have never seen can be booked automatically at high confidence, on nothing more than the name looking plausible. Review new vendors yourself for the first few months."** The live case: a never-seen vendor booked at **88** while one taught eight times was asked again at **78**. | **`O102`** / C203 |
| **A4** | **"A recognisable supplier can still land in Miscellaneous."** Live instance: CO2 tanks and bagged ice → `7100`. | ROADMAP TIER 1 **#7** |

## B. THE SCREEN CAN SAY THINGS THAT ARE NOT TRUE

*Books correct, description wrong. Embarrassing rather than dangerous — but it is the surface they judge us by.*

| # | what we would have to tell them | closes with |
|---|---|---|
| **B1** | **"The home screen can say your books are correct and up to date while questions are still waiting for you."** The check behind that sentence never looks at the questions. | **`O121`** |
| **B2** | "The summary of a booking can name a category the ledger disagrees with — the books are right, the sentence is guessing." | **`O115`** (3 sites) |
| **B3** | "When we file an invoice against a payment we already had — the best thing this feature does — we report it as *'0 invoices booked · $0.00'*." | **`O128`** |
| **B4** | "One supplier can appear several times in the vendor list; a trailing full stop is enough to split them. Payroll appears as fifteen separate vendors." | **`O125`** |
| **B5** | "We will flag your weekly supplier as a possible duplicate payment every single week." | **`O117`** |

## C. THINGS THEY CANNOT DO YET

| # | what we would have to tell them | closes with |
|---|---|---|
| **C1** | **"Loading your first two or three months of paperwork takes six to twelve hours of waiting, in the foreground, and it fails partway through rather than queueing."** 20 files/hour against 120–240 documents. **This is the first thing they will ever do.** | **`O97`** |
| **C2** | **"Delete is not on the screen where you inspect a transaction. It is four steps away behind a button that reads like a filter."** So the button you *will* find is Void — see **A2**. | **`O126`** |
| **C3** | "A payroll file cannot be dropped on the home screen like everything else; it has its own importer under Admin." | **`O116`** |
| ~~**C4**~~ | ~~"Uploads can be lost by a browser refresh."~~ **✅ CLOSED 2026-08-27 — `O97` step 1.** The bytes are now stored **before** the first AI call, so a refresh can no longer lose the file. *(Stays listed, struck through, until a drive confirms it.)* | `O97` step 1 |

## D. GOVERNANCE AND TRUST — the ones no drive will ever surface

> **★ THIS SECTION EXISTS BECAUSE NOTHING IN THE PRODUCT WILL EVER REMIND US OF IT.**
> Every other line in this file was found by using the software. **These were found by asking what
> we would owe someone, and they are the ones most likely to be forgotten** — precisely because no
> test fails and no drive turns them up.

| # | what we would have to tell them | closes with |
|---|---|---|
| **D1** | **★★ "We cannot yet tell you in writing what our AI provider does with your bank statements — how long they retain them, or whether they are used for training."** The document text travels client → our edge function → the model provider. **This is a sub-processor disclosure and we do not have the answer in writing.** **Open longer than anything else on this list, and the only item here that is a phone call rather than a commit.** | security ladder **s3** (ROADMAP TIER 1 **#11c**) |
| **D2** | **★ "You would be signing off your own books."** There is no separation between the person who keeps the books and the person who attests to them. For a client who is also their own bookkeeper that may be acceptable — **but it must be their informed choice, not our omission.** | **`O93`** (+ TIER 1 **#8**) |
| **D3** | **★ "'Who has looked at my books?' has no answer."** We log every *change*. We log no *reads at all* — including support access by us. A client asking the most natural privacy question about an accounting system gets nothing. | §11 security Tier 2 (read-audit) |
| **D4** | "Deleting something does not purge it. We soft-delete for recoverability and audit trail, so it remains in the database." **Deliberate and defensible — and it must never be described as deletion.** | architecture (§7); disclosure only |
| **D5** | "Our tenant isolation was reviewed by us. It has not been reviewed by anyone else." 33/33 tables verified and probed live with a non-privileged account — **and we reviewed a thing we built.** | ladder **s5** / **s6** |

---

## THE SHORTEST PATH TO A SHORTER LIST

`O97` clears **C1 + C4** · `O127`+`O117` clears **A1 + B5** · `O123`+`O126` clears **A2 + C2** ·
`O121` clears **B1**.

**That is four workstreams against nine disclosures — and it leaves all of section D untouched,
because none of section D is code.**
