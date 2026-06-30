# VERIFICATION.md — live manual-test checklist

**Why this exists:** unit tests passing ≠ works live. The recurring gap is *green tests, broken on mount / on real data* (render-before-data flashes, ReferenceErrors on load, persistence that "passes" in a fake DB but never hit the real one). This is the precise click-through list to run at a full setup, so verification is a checklist, not a guessing game.

**Legend:** ⬜ unverified · ✅ verified live · ❌ found broken (open a fix) · ⏳ blocked (needs setup/data)

**Risk:** **HIGH** = silently broken = bad (lost data, wrong numbers, missing transactions, trust). **MED** = noticeable but recoverable. **LOW** = cosmetic / nav polish. **Verify HIGH first.**

**Process:**
- Every item: **what it is · exact steps · expected result · risk**.
- When something ships that needs live verification, it gets **added here** (steps + expected + risk) and the commit report says so.
- Mark ✅ only when *confirmed in the running app*. Tell the author when you've confirmed something and they'll flip it.

> Most items need a company with booked data. A few need specific setup (a Stripe-style direct deposit, an A/R invoice + its collection, a bank statement to reconcile, a fresh bank upload). Those are called out.

---

# 🔴 HIGH RISK — verify first

## H0. ⚠️ AI reasoning shows real classification, NOT "Imported from bank statement" — **SUSPECTED STILL BROKEN**

**Risk: HIGH** · **Status: ⬜ SUSPECTED-STILL-BROKEN — never confirmed live.**

*What/history:* the detail panel's "AI REASONING" should explain *why this GL account* (vendor → account), not the provenance string "Imported from bank statement". Two fixes shipped: **C107** added a display-time derive, but it was a **no-op** (it called `classifyBankReason`, which echoed the stored provenance back). **C109** hardened `classifyBankReason` so a provenance string is treated as *absent* → it derives a real reason. **The open problem:** you clicked a bank txn *after a fix* and it **still showed "Imported from bank statement"**; we hand-waved "needs a fresh upload" and **never actually confirmed**. So this is unverified on **two** independent paths:

- ⬜ **H0a · existing entry, display-time derive (should work post-C109, no re-upload)** — *Steps:* open an **already-booked** bank-imported transaction → read the AI REASONING box.
  *Expected:* a real classification ("Categorized to <account> based on <vendor>" or the categorizer's rationale) — **NOT "Imported from bank statement"**.
  *If it STILL shows the provenance string here → C109's display derive is NOT working live → reopen as a real bug* (the most likely culprit: the panel isn't routing through the hardened `classifyBankReason`, or `sel.reasoning` arrives in a shape the regex misses — capture the literal stored value).

- ⬜ **H0b · fresh bank upload, stored-at-write (the "deferred" path)** — *Steps:* upload a **new** bank statement → book a line → open that transaction.
  *Expected:* real "why this account" reasoning from the categorizer (the prompt now asks for it), never the provenance string.

> Verify BOTH. H0a is the one that was reported broken — if it fails, do not mark this area green.

## H1. Chatbot action persistence (O78 / O51 — C112)

**Risk: HIGH** (silent data loss — the exact false-success class C112 fixed). **The check for every action: do it in chat → hard-refresh → confirm it stuck.**

- ⬜ **H1a · add_rule** — "code Adobe to Software" → refresh → **Settings → Rules** shows it; a later Adobe upload auto-codes to Software.
- ⬜ **H1b · delete_rule** — "remove the Adobe rule" → refresh → it's gone and stays gone; other rules untouched (scoped, O51).
- ⬜ **H1c · add_recurring** — "add a $2,000/month rent expense" → refresh → **Settings → Recurring** shows it (monthly, next date).
- ⬜ **H1d · pause_recurring** — "pause the rent recurring" → refresh → shows paused/inactive.
- ⬜ **H1e · add_contact** — "add a vendor called Pixel Contractor" → refresh → **Books → Vendors** lists it.
- ⬜ **H1f · update_contact** — "set Pixel Contractor's email to a@b.co" → refresh → saved. (Asking to set a non-column field → bot says it couldn't, not a false success.)
- ⬜ **H1g · set_contact_rule** — "code everything from Pixel to Professional Services" → refresh → both the **contact** and the **rule** persist.
- ⬜ **H1h · retag_project** — "tag the last 3 AWS charges to project Apollo" → **refresh** → open one row → project = Apollo and **survives refresh** (was unpersisted *and* mis-targeted before C112; now writes JE lines + flatten reads it back).
- ⬜ **H1i · delete_invoice (verified)** — "delete the $X Pixel entry" → refresh → gone & stays gone; "not found" if none (no false "deleted ✓").
- ⬜ **H1j · void_invoice (verified)** — "void the $X entry" → refresh → reversing entry present; only claims "voided" when the reversal posted.
- ⬜ **H1k · delete_contract (verified)** — "remove the WeWork contract" → refresh → **Books → Contracts** no longer lists it; "no matching contract" if none.
- ⬜ **H1l · honest-on-failure spot check** — trigger an action that can't resolve → reply is honest ("couldn't…/not found"), never a confident false "✓ done".

## H2. Document completeness — intake ledger (O60 — C113)

**Risk: HIGH** (the whole point is *nothing silently missed*). **Prereq:** migration `047_document_intake_ledger.sql` applied in Supabase.

- ⬜ **H2a · arrival logs 'received' BEFORE processing** — upload any doc → in Supabase `select * from document_intake order by received_at desc limit 5` → a row with `status='received'` (then advancing), filename, `content_hash`, `source='upload'`.
- ⬜ **H2b · booked → 'recorded' + JE link** — upload a clean invoice that books → re-query → `status='recorded'`, `journal_entry_ids` populated.
- ⬜ **H2c · routed/unknown/bank → 'held_for_review' (never void)** — upload a bank statement + an unrecognizable doc → their rows are `held_for_review` with a `detail` reason.
- ⬜ **H2d · errored → 'failed'** — upload a corrupt/blank scan → `status='failed'` with a `detail`.
- ⬜ **H2e · THE GUARANTEE — reconciliation surfaces a dropped doc** — simulate a drop: leave/insert an intake row `status='received'`, `received_at` ~60 min ago, with **no** JE. Call `reconcileDroppedDocs` (or `select * from document_intake where status not in ('recorded','held_for_review','rejected')`).
  *Expected:* that row is **flagged "received but never recorded"** even though no JE/document exists — independent of the recording pipeline.
- ⬜ **H2f · intake-write failure surfaces (no silent swallow)** — if you can force the insert to fail → a visible non-blocking notice + console error; upload still proceeds.

## H3. Dashboard open-receivables / open-payables — GL-truth rewrite (C110)

**Risk: HIGH** (wrong AR/AP counts = misstated position). **Prereq:** a Stripe-style direct revenue deposit (Dr Cash / Cr Revenue) + a real open A/R invoice; similarly a direct-cash expense + a real A/P bill.

- ⬜ **H3a · open receivables excludes the non-receivable** — the "open receivables" card + its drill **exclude the Stripe deposit** (no A/R leg), include only genuine open A/R; **count = list sum = GL A/R** all agree (was: header right $6,800, but count/list wrongly included Stripe).
- ⬜ **H3b · open payables excludes direct-cash expenses** — same: only genuine A/P bills counted; count/list/total agree.

## H4. Matched-settlement links — both directions (C109)

**Risk: HIGH** (traceability / trust — a broken link means you can't follow a settlement to what it cleared). **Prereq:** a collected A/R invoice (collection clearing entry exists) and/or a paid A/P bill.

- ⬜ **H4a · settlement → original** — open a collection/payment clearing entry → "↔ MATCHED SETTLEMENT" reads e.g. "Cleared the Pixel Contractor bill ($1,800)" → **View →** navigates to that bill/invoice.
- ⬜ **H4b · original → settlement (reverse)** — open the now-settled original → "Settled by payment/collection on DATE" → **View →** navigates to the clearing entry. Test from Books, Vendors, and a Reports drill panel.

## H5. Chatbot Q&A numbers tie to the ledger (read side)

**Risk: HIGH** (a confidently-wrong bookkeeper is worse than none).

- ⬜ **H5a · figures match reports** — ask "how much on software last quarter?", "what's my runway?", "show everything from <vendor>" → cross-check one figure against the dashboard/report; must match to the penny (bot queries, doesn't guess).

## H6. O49 — AI confidence flagging — **NOT BUILT YET**

**Risk: HIGH** (it's the trust-layer surfacing of silent errors). When shipped, verify:
- ⬜ **H6a** — a clean, unambiguous txn is **not** flagged.
- ⬜ **H6b** — an ambiguous / low-confidence txn **is** flagged, with a reason.
- ⬜ **H6c** — a clean batch does **not** over-flag (no "flag everything" noise).

---

# 🟠 MEDIUM RISK

## M1. Runway drill-in ties to the card (C108)

**Risk: MED.**
- ⬜ **M1a** — note the Runway card figure → click in → the breakdown (cash ÷ avg monthly burn = N months) shows **the same N** as the card. Especially when recent months have no expenses but an earlier month does (the old bug showed "∞ / —" in the drill).

## M2. Report account-drill total is NET, ties to the account (C110)

**Risk: MED** (correctness of a displayed total).
- ⬜ **M2a** — drill into a balance-sheet account or P&L category with both debits and credits (e.g. A/P with a bill + its payment) → header total is the **net** (debits − credits) and equals that account's Balance-Sheet / trial-balance figure — not the gross sum. Count stays correct.

## M3. ReconView full loop → dashboard flips (O79 — C109)

**Risk: MED.** **Prereq:** a bank statement to reconcile.
- ⬜ **M3a · run it end-to-end** — Books → Reconcile (or dashboard CTA) → enter statement ending balance → review matches → **Complete** → shows the difference; writes a recon record (no error).
- ⬜ **M3b · dashboard flips** — Financial Health breakdown flips **"Never reconciled to bank" → "Last reconciled X days ago"** + 20 pts. A merely *started* draft must NOT flip it (only a completed reconciliation).

## M4. Reconcile CTA launches ReconView (C109)

**Risk: MED.**
- ⬜ **M4a** — Financial Health card (when unreconciled) → **Reconcile now →** opens the Reconcile flow. Also reachable via **Books → Reconcile** sub-tab.

## M5. Source document view from a transaction (O74 substrate)

**Risk: MED.** **Prereq:** `documents` Storage bucket + migrations 002/013/014; a transaction that came from an uploaded doc.
- ⬜ **M5a** — open such a transaction → **SOURCE DOCUMENT** section → click → the original PDF/image renders inline (signed URL). (Manual-entry / bank-line txns have no source doc by nature.)

## M6. Sentry error reporting (O26 — C102)

**Risk: MED** (broken = no production error visibility). **Prereq:** `VITE_SENTRY_DSN` set in Vercel; test on the **deployed** app.
- ⬜ **M6a** — trigger a known error in the deployed app → the event appears in the Sentry dashboard within ~1 min; financial fields scrubbed; "our team has been notified" only shows when Sentry is actually enabled.

---

# 🟢 LOW RISK — cosmetic / nav

## L1. Report drill-down navigation (C105)

- ⬜ **L1a · Back steps one level** — Income Statement → a line → a transaction → **Back** lands on the line-item list (not the top); Back again → the report. **Risk: LOW.**
- ⬜ **L1b · hover readable** — hover rows across Reports / drills / Books / AP / Recon / Vendors / Dashboard → subtle **dark** shade, readable text (no white-on-white). **Risk: LOW.**
- ⬜ **L1c · sub-tab survives refresh** — Reports → Balance Sheet → hard-refresh → still on Balance Sheet (also the Payables sub-tab + Books filter). **Risk: LOW.**

## L2. Transactions tab display (C106)

- ⬜ **L2a · collection = green +, against A/R, no "Mark Paid"** — a collection clearing entry shows money IN, the A/R it cleared (not "Cash"), status "Received", no settle button. **Risk: MED** (wrong sign/account is misleading — but visible, recoverable).
- ⬜ **L2b · payment = red −, against A/P, no button** — payment clearing entry shows money OUT, the A/P it cleared, status "Paid". **Risk: MED.**
- ⬜ **L2c · open items still offer the right action** — unpaid A/P → **Mark Paid**; uncollected A/R → **Mark Received**; status "Open". **Risk: MED.**
- ⬜ **L2d · vocabulary + no right-edge cutoff** — plain labels (Open/Received/Paid/…); table scrolls in its card, doesn't clip. **Risk: LOW.**

## L3. Dashboard onboarding checklist — no flash (C107)

- ⬜ **L3a** — with a fully-onboarded company, hard-refresh Home repeatedly → the "0 of 4 / Welcome" checklist **never flashes** before data loads. **Risk: LOW.**

## L4. Chatbot 200-row search truncation disclosure (C111)

- ⬜ **L4a** — ask "show everything from <vendor with >200 txns>" → the bot says "showing the 200 most recent of N" and that the total covers everything (never presents a partial list as complete). **Risk: LOW.**

---

## Not-yet-built placeholders (add steps + risk when shipped)

- ⬜ **O60 Phase 2 · bank-line completeness** *(not built)* — every imported statement line resolves to an entry or explicit categorization; unresolved lines surfaced. **Risk: HIGH.**
- ⬜ **O60 · completeness dashboard** *(not built)* — "X received, all accounted for (Y recorded, Z review, W rejected)". **Risk: MED.**
- ⬜ **O81 · chatbot adversarial battery** *(not built)* — attack/edge prompts; guardrails hold (no destructive coercion, no bulk-cap bypass, no prompt-injection-via-doc, refuses out-of-scope). **Risk: HIGH.**
