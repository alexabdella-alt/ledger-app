# FIVE NICHE TEST MONTHS — RUN SHEET AND FINDINGS

**Written 2026-10-01.** One realistic month of paperwork for each of the five niches weighed as
targets other than restaurants. Each is a fixture like the restaurant month (`DRIVE4_ACCEPTANCE.md`):
synthetic documents, an answer key written **before** the run, and planted cases taken from how
each kind of business actually goes wrong.

| Niche | Company to create (exact name) | Business type at onboarding | Documents |
|---|---|---|---|
| Solo consultant | **Lakeview Strategy LLC** | Consulting/Services | 19 |
| Online coach & course creator | **Bright Path Coaching LLC** | Consulting/Services | 19 |
| Small landlord (two properties) | **Oakmont Rentals LLC** | Real Estate | 18 |
| HVAC & home-services shop | **Cedar Creek Home Services LLC** | Construction | 20 |
| Solo therapist | **Clear Water Counseling PLLC** | Healthcare | 18 |

Source of truth: `tools/niches/<niche>.json`. Images: `python3 tools/makeNicheMonths.py` →
`tools/niche-fixtures/<niche>/` with `ANSWER-KEY.txt` (gitignored; reproducible byte for byte).

---

## 1. What was checked OFFLINE, and what only a live run can check

**Offline (`tests/nicheMonths.test.js`, runs in the suite):** for every document, does a new
company of that type have somewhere correct to file it, and where does the owner's natural answer
on a question card send it? Both are pure functions of the chart and the answer logic, so they
were checked for all 94 documents without opening the app. **The findings are pinned exactly**;
a fix must shrink the list in the same commit.

**Only live:** whether the app READS each image correctly — vendor, amount, date, which side of
the bill the company is on — and what the AI categoriser chooses before anyone answers anything.

## 2. Running one live

1. `python3 tools/makeNicheMonths.py <niche>` (or no argument for all five).
2. Create a **fresh company with the exact name in the table** — the documents are addressed to
   it, and that is how the app tells money in from money out. Pick the business type shown.
3. Starting balances: **Day One = 2026-08-01**, any non-zero cash. Every document is August 2026.
4. Drop **files 01–08**, answer every card, then drop the rest. (Same reason as the restaurant
   run: answering first is the only way to see whether it stops asking.)
5. Score against `ANSWER-KEY.txt` — every line has the treatment a competent bookkeeper would
   use, and ★ WATCH lines name the planted case and what a wrong answer costs.

**Run the consultant first.** It is the recommended niche and the month with the fewest gaps, so
a clean run there is the strongest evidence the product is ready for it.

## 3. The planted cases — what each month is really testing

- **Everyone:** the quarterly estimated-tax payment is the OWNER's tax, not a business expense
  (owner's draw). Expensing it understates profit by thousands.
- **Consultant:** a retainer invoiced Aug 31 for September (September's income) · billing a client
  back for travel (a reimbursement, not new income) · a $2,056 laptop (the app should ask; the
  answer is expense under the $2,500 de minimis safe harbor) · a subcontractor who needs a 1099.
- **Coach:** Stripe/Kajabi payouts must be booked at GROSS with fees as an expense, not as the net
  deposit · a refund reduces income · an editor paid through Upwork does NOT need a 1099-NEC (the
  platform reports it) · personal charges on the business card are owner's draw, not expenses.
- **Landlord:** a mortgage payment is mostly NOT an expense (only interest) · a new roof is
  capitalised over **27.5 years** (the app suggests 39, the commercial life) · a tenant's
  security deposit and September rent paid early are not August income · each document names its
  property (Elm St / Burnet Rd) — per-property tracking is the landlord's real need.
- **Trades:** payroll registers (Home doesn't take them — known C3) · a customer deposit for
  September work is not August income · a $5,890 trailer is equipment · truck-loan interest only.
- **Therapist:** insurance remittances — the contractual adjustment and a denied claim are never
  income · **two documents name a client.** Under HIPAA that name is protected health information,
  and uploading it sends it to the AI provider — the 11c gap made concrete. **Don't run this one
  with real client documents until 11c is closed.**

## 4. Findings from the offline run (2026-10-01)

### Nowhere correct to file it — the chart has no category

| Niche | Document | Needs |
|---|---|---|
| Coach | Kajabi course sales (×2) | Product Revenue — the Consulting/Services set **hides** it |
| Coach | Certification course | Education & training |
| Consultant | City business license | Taxes & Licenses (the Consulting/Services set lacks it) |
| Landlord | Tenant's security deposit | A *liability* for deposits held — the only "Security Deposits" account is an asset |
| Therapist | CE workshop · association dues | Education & training · Dues & subscriptions |
| Trades | Truck fuel (×3) | Vehicle expenses |

### An owner's answer files instantly to the wrong place — bugs for every business

- *"city business license"*, *"license renewal"*, *"contractor license renewal"* → **Software**
  (`license` is read as a software license).
- *"electrician I subbed out"* → **Utilities** (`electric` matches "electrician").
- *"listing the unit for rent"* → **Rent** (it is advertising).
- *"paint and supplies to fix up the unit"* → **Office Supplies** (there is no repairs rule).
- *"malpractice insurance"* → general Insurance, though the Healthcare set has a Malpractice category.

### Structural, not fixable with a word list

- **A mortgage or truck-loan payment answered on a card books to ONE category.** It needs a split
  (interest / principal / escrow). The statement shows the split; only the reading path can use it.
