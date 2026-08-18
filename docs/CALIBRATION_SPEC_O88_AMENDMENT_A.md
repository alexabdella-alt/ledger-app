# AMENDMENT A — SHADOW-MODE PASS CRITERION (O88)
**Status:** DRAFT FOR SIGN-OFF · 2026-08-17 · amends `CALIBRATION_SPEC_O88.md` (signed 2026-08-16)
**Governs:** C201–C202 (shadow mode) and the decision to proceed to C203 (the booking switch).
**Written BEFORE the numbers exist. That is the entire point.** A criterion written after the
results arrive is not a test, it is a description of whatever happened.

---

## 0. WHAT SHADOW MODE IS

The ladder computes its verdict for every bank-sourced line **alongside** the current
confidence path, records both, and **books nothing**. No journal entry, no account, no flag
reaches a human surface. The existing behaviour is untouched and remains the only thing that
books.

The output is one shadow record per line: `{ line_id, descriptor, entity_key, matched_via,
tier, proposed_account_id | UNCATEGORIZED, attested_account_id, verdict }`.

---

## 1. SCOPE — WHICH MONTHS

- **Minimum: July 2026 and August 2026.** July is attested and signed (O87). August must be
  attested and signed before its lines count — an unattested month has no answer key.
- Shadow mode may run over earlier attested months (Jan–June) as **supporting** evidence.
  Those months predate several booking changes, so a disagreement there is informative but is
  not on its own a hard fail.
- **Franklin Ave only.** It is the only company with attested history.

### 1a. SAMPLE-SIZE HONESTY — READ BEFORE INTERPRETING ANY RESULT
July carried **21 statement lines**. Two months is plausibly **40–60 lines**. That cannot
support a rate claim, and no clause below states one. **This criterion is STRUCTURAL, not
statistical**: it asks whether specific things ever happen, not how often. "97% agreement" is
not a sentence this document will ever produce, because 40 lines cannot mean it.

---

## 2. THE ANSWER KEY

For each line, the truth is **the account it was booked to in a month the CPA attested**.
Not what the AI proposed, not what confidence scored — what a human signed.

Lines excluded from the comparison, listed so the exclusions are visible rather than quiet:
- lines whose journal entry is soft-deleted (`deleted_at` not null) — see O108 finding B;
- lines booked to an account with `system_role IS NULL` (the O108 runtime-materialised
  accounts, `3400`/`6520`/`6530`) — **these are reported separately and NOT scored**, because
  the answer key itself is questionable there;
- transfers between own accounts, and payroll register entries (not bank-sourced).

---

## 3. VERDICT CATEGORIES

| Verdict | Meaning | Scored as |
|---|---|---|
| **AGREE** | Ladder proposes the attested account | Pass |
| **PARK** | Ladder proposes Uncategorized; attested account is real | **Safe. Reported, NOT a gate** |
| **DISAGREE** | Ladder proposes a DIFFERENT real account than attested | Itemised (§4.2) |
| **PHANTOM** | Ladder classifies STRANGER yet proposes a real account | **Automatic fail (§4.1)** |
| **MERGE** | Two distinct attested vendors resolve to one `entity_key` | **Automatic fail (§4.1)** |

**PARK IS NOT A FAILURE AND MUST NEVER BECOME A GATE.** Parking is the ladder saying "I do not
know", which is the behaviour the whole spec is built to produce. Gating on park rate would
create pressure to guess — reintroducing plausibility scoring through the back door. Park rate
is a **coverage** measure; the census (Q6) and the directory (UNIVERSAL tier) are the
instruments that reduce it, not a lower bar for booking.

---

## 4. HARD FAILS AND ITEMISED REVIEW

### 4.1 Automatic fail — no threshold, no discussion
1. **Any PHANTOM.** A STRANGER resolving to a real account is a structural violation of Rule 2,
   not a tuning problem. One occurrence stops the switch.
2. **Any MERGE.** Two attested vendors under one entity key is the Q4 one-way door: one
   vendor's attested mapping laundering onto another's charges, invisibly. One occurrence stops
   the switch.
3. **Any ladder verdict that varies across runs on identical input.** KNOWN is a persistent
   state (Q3), not a recomputation; a flapping verdict means the state machine is not a state
   machine.

### 4.2 Itemised review — every one, individually, by the CPA
**Any DISAGREE on a KNOWN vendor is itemised and reviewed one at a time.** Not aggregated, not
rate-limited. Each resolves to exactly one of:
- **(a) the ladder is wrong** → a defect; fix before proceeding;
- **(b) the attestation was wrong** → the CPA corrects the historical booking, and the item
  becomes evidence the ladder found a real error;
- **(c) both defensible** → the mapping is genuinely ambiguous; record the decision and the
  reason, and the vendor's attested mapping is set explicitly.

**Proceeding requires the itemised list to be EMPTY — every item resolved into (a), (b) or
(c).** An unresolved DISAGREE is an unanswered question about a signed month.

---

## 5. PROCEED / STOP

**PROCEED to C203 when ALL hold:**
- 0 PHANTOM · 0 MERGE · 0 run-to-run variance (§4.1);
- the §4.2 itemised list is fully resolved;
- shadow mode has run over **at least two attested months**, one of which is August;
- every STRANGER-classified line proposes Uncategorized and nothing else;
- park rate is **reported with its numerator and denominator**, and the report says which
  vendors were parked and why (census gap, directory gap, or genuinely new).

**STOP and return to build when ANY hold:**
- any §4.1 fail;
- a DISAGREE that resolves to (a) — the ladder is wrong — in more than one distinct vendor;
- identity resolution requires a new rail-stripping rule to reach agreement (this means the
  corpus was under-specified; extend the corpus and re-run rather than tuning to the answer);
- the shadow record cannot be produced for every in-scope line (a gap in coverage is a gap in
  the evidence, and an unmeasured line is not a passing line).

**AMBIGUOUS — neither proceed nor stop:** fewer than 20 scored lines. Run another month. This
clause exists so a thin month cannot be read as a pass.

---

## 6. COPY DOCTRINE — QUERY-CLAIMS ONLY (Q9)

Everything the shadow report says is a claim about what was **measured**, never about the
world:
- ✓ "The ladder proposed the attested account on 34 of 41 scored lines" · ✗ "97% accurate"
- ✓ "7 lines parked in Uncategorized — no attested mapping existed for those vendors" ·
  ✗ "7 lines failed"
- ✓ "No line classified STRANGER proposed a real account" · ✗ "The ladder is safe"
- ✓ "Two descriptors resolved to one vendor; both were attested to the same account" ·
  ✗ "Identity resolution works"

---

## 7. WHAT THIS CRITERION DOES NOT CLAIM

- It does not establish a rate, an accuracy figure, or a confidence interval (§1a).
- It does not test the UNIVERSAL tier meaningfully — the directory starts near-empty, so a
  near-zero UNIVERSAL population is expected and is not evidence of anything.
- It does not test the census pass (C205, unbuilt).
- **It cannot prove the ladder is right about a vendor the CPA has never attested.** For those,
  parking is the only correct behaviour and the only thing being tested is that it parks.

---

## SIGN-OFF

- [ ] Alex (CPA) — shadow-mode pass criterion as written, §§1–7

*Upon signature: C201 is released from ▶ HOLD and shadow mode may be built to this standard.
Until then C201 remains held. Standing rules per CLAUDE.md — verify-don't-trust, checkable
artifacts, ▶ RUN NOW/HOLD markers, migrations manual, `git log origin/main..HEAD` printed.*
