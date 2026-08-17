# SHADOW — CALIBRATION SPEC (O88)
**Status:** DRAFT FOR SIGN-OFF · Session O88 · 2026-08-16
**Scope:** Bank-sourced transaction booking calibration. Invoice calibration explicitly out of scope (own drive).
**Supersedes:** Descriptor-legibility confidence scoring as a booking authority.

---

## THE THREE RULES

1. **Book everything, always.** A bank line is a fact — money already moved. The ledger reflects it immediately. Nothing gates booking of bank-sourced lines: not amount, not familiarity, not score.
2. **The only question is which account.** The mapping must come from **knowledge** — this company's attested history, the attested onboarding census, or the curated global directory — never from semantic plausibility. Where knowledge is empty, the line books to **Uncategorized Expense** (honest suspense), never to a guess.
3. **Humans review in batches.** One flag queue, reviewed at close (glaring items surface immediately). Unresolved flags block month sign-off — never booking, never reconcile.

Everything below is these rules meeting specific cases.

---

## THE FAMILIARITY LADDER (Axis 1 — CPA-owned, house rules, not customer-adjustable)

| Tier | Definition | Booking behavior |
|---|---|---|
| **KNOWN** | Graduated: two attested observations across two distinct statement-months, agreeing mapping, second within pattern tolerance of first | Books to attested mapping. In band: **silent**. Out of band: **book + flag** |
| **DECLARED** | Attested in onboarding census; no graduation yet | Books to census-attested mapping + **flag every booking** until graduation |
| **UNIVERSAL** | Hit in curated global directory (canonical identity + curated default mapping) | Books to directory default + **batched flag by vendor** until first attestation converts mapping to company-attested and starts the KNOWN clock |
| **STRANGER** | No history, no census, no directory | Books to **Uncategorized Expense** + flag. Never books to a guessed account — at any amount, at any legibility score |

**Directory constraint (load-bearing):** the universal directory is curated and **binary** — a vendor is in it with one canonical mapping, or it is not in it. No fuzzy-match scores, no "76% consulting-ish." Directory membership is a house-rules artifact owned by the CPA. This is the line separating *recognition* from the plausibility scoring this spec kills.

**Confidence:** dies as a standalone authority. Descriptor legibility survives only as an input to identity resolution. Any surviving number labeled "confidence" is a derived display value, never a booking input.

---

## AXIS 2 — MATERIALITY (customer dial)

- Governs flag behavior for KNOWN vendors only. It is a **notification boundary, not a booking gate.**
- Expressed **relative to the business** (% of vendor pattern / % of monthly spend), not absolute dollars. Scales food-truck → multi-location.
- **Defaults do the work.** Sane per-tier defaults ship; the dial exists for the opinionated customer.
- Band width is derived from **observed vendor variance**, not a flat ±% — a produce vendor with legitimate seasonal swing earns a wide band; a fixed-fee linen service earns a tight one.

---

## Q1–Q9 RESOLUTIONS

**Q1 — KNOWN clock.** Two attested observations in two distinct statement-months, agreeing mapping, second within tolerance of first. Same-month repetition (weekly vendors) tightens amount-tolerance estimation but never accelerates the clock. No exceptions. *(Bluebonnet under this rule: KNOWN at month-2 close, auto-booking month 3 — five wasted attestations eliminated.)*

**Q2 — "Within pattern."** Amount band derived from observed variance around the vendor's attested pattern; cadence tracked as expected-recurrence window. Both inform flag copy ("2.4x this vendor's pattern"); neither gates booking.

**Q3 — Stability.** KNOWN is a **persistent state on the vendor record**, not a monthly recomputation. Descriptor noise never demotes. *(Lone Star's four-month flap becomes four identical verdicts.)* Demotion triggers, exhaustively:
- **Mapping correction** by CPA → immediate demotion (worst silent-error class).
- **Dormancy** — unseen 6 months → decay to DECLARED (identity survives; pattern data stale).
- **Amount behavior never demotes and never pauses.** Out-of-band lines book and flag; attesting the flag re-anchors the pattern. One attestation cures.

**Q4 — Strangers / de-minimis.** No de-minimis floor. Strangers never book to a guessed account at any dollar amount — the harm model is identity, not dollars (a phantom vendor accruing unattested history is a one-way door). Stranger lines book to Uncategorized; month-end routing attests identity and starts the clock. Exception volume is solved by the census (Q6) and the UNIVERSAL tier, not by booking exceptions.

**Q5 — Absolute ceiling.** None on bank-sourced lines. A bank line is a fact; facts book. Extreme multiples surface as **immediate** (not batched) flags. Fraud mitigation lives in the s-ladder and access controls, not calibration — flags guarantee a human *sees* the anomaly, which is the only anti-fraud property a scoring system can honestly claim.

**Q6 — Onboarding-declared census.** Seed the vendor universe from the first 2–3 statements: statement-derived census + confirmation pass (no invoice homework). Confirmed vendors enter at DECLARED. **UI honesty requirement:** the confirmation pass must state that confirming a vendor+mapping authorizes booking-with-flags — census attestation carries real booking weight and the UI may not soften this.

**Q7 — Dismissal-with-reason (O86(m)).** Flag dismissals carry a reason. "User confirmed recurring" suppresses future same-class cards AND seeds rule suggestions. Dismissal **never silently changes booking behavior** — rule changes surface as explicit suggestions requiring attestation.

**Q8 — Outstanding chain.** Unchanged. Months with outstanding items decline to CPA session. Auto-reconcile completes on a verified tie regardless of open flags — **the tie is arithmetic; flags gate the ceremony, not the math.**

**Q9 — Copy doctrine (Q2 doctrine applied to flags).** Every claim the system makes is a **query-claim, never a world-claim**:
- ✓ "2.4x this vendor's attested pattern" · ✗ "unusually large purchase"
- ✓ "No attested mapping exists — parked in Uncategorized" · ✗ "Probably supplies"
- ✓ "Same amount, same vendor, 3 days apart" · ✗ "Possible fraud"
- ✓ "Booked 47 Facebook charges, $2,340 total, to Marketing — if that's wrong, tell us"

---

## FLAG QUEUE MECHANICS

- **One queue.** Routine flags batch to month-end review. Extreme-multiple and suspected-duplicate flags surface immediately.
- **Batching:** universal-tier flags batch by vendor (one card for 47 Facebook lines, not 47 cards).
- **Duplicate suspicion:** same vendor + same amount + tight window → immediate flag as suspected duplicate payment. (True duplicates tie — they're an operations problem, recover from vendor. Phantom duplicates break the tie — reconciliation catches structurally; August trap-month re-upload probe covers this.)
- **Resolution semantics:** attesting a flag re-anchors pattern. Dismissing requires a reason (feeds O86(m)). Unresolved flags block sign-off only.

---

## BUILD SURFACES (flagged honestly for Tier 1 scoping)

1. **Identity resolution** (descriptor → entity) is now load-bearing — it does the real work the legibility score pretended to do. Needs its own test fixtures (Lone Star's four descriptor variants are the seed corpus).
2. **Universal directory** — a curated asset, starts near-empty, needs a maintenance discipline and an authoring surface. Scope minimally: top-N national vendors (payment processors, ad platforms, utilities, major distributors).
3. **Vendor state machine** — KNOWN/DECLARED/UNIVERSAL/STRANGER as persisted state with graduation, demotion, decay transitions. Migration for existing Franklin Ave vendor history (Bluebonnet et al. should graduate on historical attestations at deploy).
4. **Flag queue + sign-off gate** — new surface; interacts with existing attestation ceremony and C198(h) reconcile demotion.
5. **Census/onboarding confirmation pass** — new UI surface with the Q6 honesty requirement.

---

## SIGN-OFF

- [ ] Alex (CPA) — familiarity axis house rules, ladder, Q1–Q9 resolutions as written

*Upon signature: becomes Tier 1 commit spec. Full zip review, standing rules per CLAUDE.md — verify-don't-trust, checkable artifacts, ▶ RUN NOW/HOLD markers, migrations manual, `git log origin/main..HEAD` printed everywhere.*
