# AMENDMENT B — BACKFILL GRADUATION BAR (O88)
**Status:** DRAFT FOR SIGN-OFF · 2026-08-24 · amends `CALIBRATION_SPEC_O88.md` (signed 2026-08-16)
**Governs:** the historical vendor-state backfill only. **Live graduation (Q1) is UNCHANGED.**

---

## 0. READ THIS FIRST — WHAT THIS RULE DOES ON TODAY'S DATA

**It graduates nothing. Zero of thirteen vendors.**

Not "few". Not "the well-evidenced ones". **None.** The rule requires at least one
EXPLICITLY attested observation, and the historical data contains **zero explicit
observations out of 63** — `exception_resolved` is null on every row, and `recoded`
cannot be derived at all because a recode updates `journal_entry_lines.account_id`
**in place** and leaves no marker (O108 finding).

So on current data this rule and "nothing graduates from backfill" are **the same
statement**. It is adopted as a rule rather than written as a flat prohibition because
the rule stays correct if the data ever becomes discriminating (see §4) — but nobody
should sign this believing it performs a test. **It does not. It defaults.**

The practical consequence, stated plainly: **every vendor starts STRANGER and re-earns
KNOWN over its first two live months.** Bluebonnet Linen Service costs **two**
confirmation cards instead of the seven it has already cost. Slower than a backfill
that graduates, and honest, which the alternative is not.

---

## 1. THE RULE

A vendor graduates to KNOWN **from historical data** only if **at least one** of its
qualifying observations was **EXPLICITLY attested**:

- **EXPLICIT** — a human touched that line directly: an exception it resolved, or a
  recategorisation it performed.
- **IMPLICIT** — auto-booked, and merely sitting inside a month later signed off.

Implicit observations still count as **history** (they inform the amount band, the
cadence and `observation_count`). They cannot, alone, graduate a vendor.

All of Q1's other conditions continue to apply unchanged: two observations, two
distinct statement-months, agreeing mapping.

---

## 2. WHY — SIGNING A MONTH IS NOT EXAMINING A VENDOR

The two are indistinguishable in the historical data, and treating them as equivalent
promotes exactly the thing this program exists to catch.

**The proof is Specimen 3.** `CULINARY EDGE CONSULTING LLC` — two auto-bookings of
$850.00, April 14 and May 14, two signed months, agreeing mapping, identical amounts.
Under the unamended rule the preview graduates it to **KNOWN**.

That vendor is the **founding incident of the familiarity axis**: never seen before,
auto-booked at confidence 88 on name plausibility alone, into the wrong ledger class —
the program's only wrong-class entry. **The migration built to make that impossible
would have promoted the specimen that motivated it**, on the strength of two months
nobody examined, and it would have arrived as a clean row in a green preview.

A backfill that cannot tell "reviewed" from "didn't notice" must assume the second.

---

## 3. SCOPE — LIVE GRADUATION IS NOT TOUCHED

Q1 governs live graduation and is unchanged. The asymmetry is deliberate and is not a
double standard:

- **Live**, an observation is created in the present, where an exception resolution or
  a recode is recorded as it happens. The distinction is available.
- **Historically**, it is not — and the stricter bar is the cost of that gap, borne
  where the evidence is missing rather than pretended away.

---

## 4. WHAT WOULD MAKE THIS A REAL TEST

The rule becomes discriminating the moment recodes and exception resolutions are
recoverable per line. That needs one of:

- a recode marker on the line (O108 established there is none — `persistRecode`
  updates `account_id` in place);
- an `account_materialized`-style audit trail for recodes, queryable per line;
- exception resolutions carried on the line rather than only on the statement.

None exists today. **Until one does, this amendment's effect is total, not selective**,
and any report of it must say so.

---

## 5. WHAT THIS AMENDMENT DOES NOT CLAIM

- It does not claim historical vendors are unknown — several are plainly well
  evidenced (Bluebonnet: 23 observations across six months, one account, one amount).
  It claims **we cannot tell from the data which of them a human ever examined.**
- It does not make the backfill useless: `observation_count`, `distinct_months`,
  amount bands, `first_seen`/`last_seen` are all still seeded. Only the TIER is
  withheld.
- It does not change what happens live from the first day of shadow mode.

---

## SIGN-OFF

- [x] Alex (CPA) — backfill graduation bar as written, §§1–5

*Upon signature: `planVendorBackfill` gains the explicit-attestation requirement and the
preview is regenerated. Until then the planner is unchanged and the backfill is not run.
Standing rules per CLAUDE.md — verify-don't-trust, checkable artifacts, ▶ RUN NOW/HOLD
markers, migrations manual, `git log origin/main..HEAD` printed.*

---

## CROSS-REFERENCE (added 2026-08-26)

This amendment is the **first instance** of a rule that has since been promoted to a standing
principle in `CLAUDE.md` §9: **an attestation is scoped to the question that was asked.**

*Signing a month is not examining a vendor* is the specific form; the general form is that a human's
click is evidence about the thing they were looking at and nothing else. The **second instance** is
`docs/INVOICE_PAYMENT_SPEC_O114.md` §6 — *answering a duplicate card is not attesting a mapping* —
where the same hazard reappeared in a new costume: without a deliberate exclusion, resolving an
invoice-payment ambiguity card would have satisfied this amendment's own `>= 1 explicit` bar and
graduated vendors on paperwork volume.
