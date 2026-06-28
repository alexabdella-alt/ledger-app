// ─────────────────────────────────────────────────────────────────────────────
// Bank-import wiring (pure planner). This is the seam that ties MATCHING to BOOKING
// so a matched bank line can never be double-booked. The bug this fixes: matched
// lines were booked as standalone Dr Expense / Cr Cash entries *in addition to* (or
// instead of) the canonical clearing entry, because the "skip matched rows" filter
// keyed off ids that diverged between matching and booking.
//
// Invariants enforced here (GAAP-critical):
//   #1  ONE stable id per parsed line, used for both matching and booking. Callers
//       must assign each parsed line a truthy id BEFORE matching (never the
//       categorizer's id:0, which is falsy and silently regenerates) and pass the
//       same lines in here. We index by those ids.
//   #2  A matched bank line is NEVER booked standalone. Its only GL movement is the
//       clearing entry (AP: Dr A/P / Cr Cash · AR: Dr Cash / Cr A/R). Matched lines
//       are held out of `standalone` whether they cleared or went to review.
//   #3  No silent flag-without-GL. A line "clears" only if buildPaymentEntry would
//       actually post a balanced movement (offset is A/P/Accrued for AP, A/R for AR,
//       amount > 0, cash account known). A match that can't post a clearing entry is
//       routed to manual review — never flag-flipped, never double-booked.
//
// Pure & dependency-light so the wiring is unit-testable end to end (the component
// test couldn't catch a wiring bug — this can). See tests/bankMatch.test.js.
// ─────────────────────────────────────────────────────────────────────────────

import { buildPaymentEntry } from "./payments.js";
import { normalizeName } from "./docDirection.js";

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic high-confidence matcher (runs BEFORE the LLM pass). The AI matcher
// missed close-but-not-exact party names ("Riverside Cafe (Maria)" vs "Riverside
// Cafe") and was unreliable on the payment→bill (A/P) side even on a near-exact name.
// This pairs a bank line to an open item purely by NORMALIZED party name (suffixes
// like LLC/Inc and parentheticals stripped by normalizeName) + EXACT amount — and it
// is symmetric: a deposit clears an open A/R invoice and a payment clears an open A/P
// bill through the identical code path. Only confident (exact-amount, name-overlap)
// pairs auto-clear here; anything fuzzier still falls to the LLM/review queue.
//   - deposit  (type "revenue") → open receivable (type "revenue") → ar_clear
//   - payment  (type "expense") → open payable    (type "expense") → ap_clear
// Each open item clears at most once (greedy, first-fit). Returns autoCleared-shaped
// records carrying `bank_txn` + `bank_txn_id` so planBankImport excludes them from
// standalone booking (no double-count).
// ─────────────────────────────────────────────────────────────────────────────
export function autoMatchBankLines(parsedTxns = [], openItems = [], { amountTolerance = 0.01 } = {}) {
  const used = new Set();   // an open item may clear only once
  const matches = [];
  for (const t of parsedTxns || []) {
    const isRevenue = t.type === "revenue";
    const wantType = isRevenue ? "revenue" : "expense";
    const amt = Math.abs(Number(t.amount) || 0);
    if (!amt) continue;
    const partyNorm = normalizeName(t.vendor || t.description);
    if (!partyNorm || partyNorm.length < 2) continue;
    const cand = (openItems || []).find((i) => {
      if (used.has(String(i.id))) return false;
      if (i.type !== wantType) return false;
      const iAmt = Math.abs(Number(i.balance_remaining ?? i.amount) || 0);
      if (Math.abs(iAmt - amt) > amountTolerance) return false;
      const iNorm = normalizeName(i.vendor);
      if (!iNorm || iNorm.length < 2) return false;
      // Substring either direction so a parenthetical/suffix on either side still matches.
      return iNorm === partyNorm || iNorm.includes(partyNorm) || partyNorm.includes(iNorm);
    });
    if (!cand) continue;
    used.add(String(cand.id));
    matches.push({
      bank_txn_id: t.id,
      bank_txn: t,
      invoice_ids: [String(cand.id)],
      match_type: isRevenue ? "ar_clear" : "ap_clear",
      confidence: 99,
      amount_matched: amt,
      amount_remaining: 0,
      auto_clear: true,
      deterministic: true,
      reasoning: `Exact amount $${amt.toFixed(2)} + party "${cand.vendor}" ≈ "${t.vendor || t.description}"`,
    });
  }
  return matches;
}

// True only for A/R match types ("ar_clear", "partial_ar"). A naive
// `.includes("ar")` is WRONG — "ap_clear" and "partial_ap" both contain "ar".
export function isArMatch(matchType) {
  const t = String(matchType || "");
  return t.startsWith("ar") || t.endsWith("_ar");
}

// reconciliations.status CHECK allows ONLY these two values. The bank-upload record
// previously wrote "needs_review" when a proposed match was queued, which VIOLATED the
// CHECK → the insert failed ("couldn't save the reconciliation record"). The review
// count lives separately in bankResult.needsReview, so the record's status maps to
// "open" (not fully reconciled) which is CHECK-allowed.
export const RECON_STATUSES = ["open", "complete"];
export function reconRecordStatus(reviewCount) {
  return Number(reviewCount) > 0 ? "open" : "complete";
}

// Build the invoice-shaped entry for a bank line that books directly (matched no open
// item, OR a proposed match was dismissed). DIRECTION BY TYPE, OFFSET BY ACCOUNT — the
// offset is the GL of the account the statement belongs to (Cash 1000 for a bank
// account, Credit Card Liability 2200 for a card), NOT hardcoded Cash:
//   expense → Dr <gl_code> / Cr <offset>   (debit_credit "debit")
//   revenue → Dr <offset> / Cr <gl_code>   (debit_credit "credit")  ← deposits
// Pure (no id / booked_at — the caller adds those), so it's unit-testable and shared
// by the standalone-book and dismiss-book paths so they can't diverge.
export function buildBankLineEntry(txn, { offsetCode = "1000", offsetName = "Cash", reason = "Imported via bank statement (no open item matched)" } = {}) {
  const amount = Math.abs(Number(txn && txn.amount) || 0);
  const date = (txn && txn.date) || null;
  const isRevenue = txn && txn.type === "revenue";
  return {
    vendor: txn && txn.vendor, description: txn && txn.description, amount, date,
    type: txn && txn.type, project: "General",
    gl_code: txn && txn.gl_code, gl_name: txn && txn.gl_name,
    secondary_gl_code: offsetCode, secondary_gl_name: offsetName,
    debit_credit: isRevenue ? "credit" : "debit",
    confidence: txn && txn.confidence, reasoning: reason,
    status: "booked", source: "bank_statement",
    payment_status: "paid", payment_method_used: "bank_transfer",
    matched: true, auto_matched: true, matched_bank_date: date,
    paid_at: date ? new Date(date + "T12:00:00").toISOString() : null,
  };
}

// A proposed match is "cleared" ONLY if every clearing post actually committed a
// journal entry. markBillPaid returns false (no JE) for a local-only / unpersisted id,
// so an empty result set OR any false means nothing (or only part) cleared — the UI
// must NEVER record success or show "payment posted ✓" on a write that didn't happen
// (the false-completeness bug, O69-B; ties O60). Pure so the policy is unit-tested.
export function allClearingsPosted(results) {
  return Array.isArray(results) && results.length > 0 && results.every(Boolean);
}

// A bank debit can legitimately clear an open payable, so bank-account imports run
// AP-matching. A CREDIT-CARD charge CREATES a liability (Dr Expense / Cr 2200) and
// never clears a payable, so card imports skip matching and direct-book (O69-C). A
// missing/unknown account defaults to bank behavior (safe — matching is reviewable).
export function shouldRunApMatching(account) {
  return (account?.type || "checking") !== "credit_card";
}

// parsedTxns : the parsed/categorized bank lines, each with a stable truthy `id`.
// autoCleared, queue : matchRecords from the matching engine. Each carries
//   { bank_txn: {id,date,...}, invoice_ids: [...], match_type: "ap_clear"|"ar_clear"|… }.
// openItems : the live (flattened) ledger rows, to resolve invoice_ids → offset.
// codes : { apCode, accruedCode, arCode, cashCode, cashName } for buildPaymentEntry.
//
// Returns:
//   clears      : [{ bankId, invoiceId, side, date, entry }]  — post via markBillPaid
//   standalone  : parsed lines that matched nothing → book Dr Expense/Cr Cash
//   review      : matchRecords for the manual queue (low-confidence + unclearable)
//   skipped     : matches that should have cleared but couldn't post a GL movement
//   handledBankIds : Set<string> of bank line ids held back from standalone booking
export function planBankImport({ parsedTxns = [], autoCleared = [], queue = [], openItems = [], codes = {} } = {}) {
  const findInv = (id) =>
    (openItems || []).find((i) => String(i.id) === String(id) || String(i.db_entry_id) === String(id));

  const clears = [];
  const review = [...(queue || [])];
  const skipped = [];
  const handledBankIds = new Set();

  for (const m of autoCleared || []) {
    // Side detection MUST be precise: "ap_clear".includes("ar") is true (the "ar" in
    // "cle-ar"!), so a substring test mis-routes every AP match to the AR side and the
    // A/P clearing silently fails to post. Match the A/R type explicitly instead.
    const side = isArMatch(m.match_type) ? "ar" : "ap";
    // Exclusion key for the standalone filter. Prefer the resolved bank_txn object, but
    // FALL BACK to the engine's flat `bank_txn_id` echo so a matched line is held out of
    // standalone booking even when the bank_txn lookup failed (e.g. an id type mismatch in
    // the matching round-trip). Without this fallback a matched line gets booked twice —
    // once as its clearing entry, once as a standalone bank_import entry.
    const bankIdRaw = m.bank_txn?.id ?? m.bank_txn_id;
    const bankId = bankIdRaw != null ? String(bankIdRaw) : null;
    const date = m.bank_txn?.date || null;
    let posted = 0;
    for (const id of m.invoice_ids || []) {
      const inv = findInv(id);
      // #3: a line clears only if a balanced clearing entry would actually post.
      const entry = inv ? buildPaymentEntry(inv, side, { ...codes, date }) : null;
      if (!entry) { skipped.push({ match: m, invoiceId: String(id), side }); continue; }
      clears.push({ bankId, invoiceId: String(id), side, date, entry });
      posted++;
    }
    // #2: a matched line is never booked standalone — hold its id back regardless of
    // whether the clearing posted.
    if (bankId != null) handledBankIds.add(bankId);
    // Couldn't clear any leg → send the whole match to manual review (not booked).
    if (posted === 0) review.push({ ...m, auto_clear: false });
  }

  // Queued + unclearable matches are held out of standalone booking too (their
  // clearing posts when the user confirms the match).
  for (const m of review) { const bid = m.bank_txn?.id ?? m.bank_txn_id; if (bid != null) handledBankIds.add(String(bid)); }

  const standalone = (parsedTxns || []).filter((t) => !handledBankIds.has(String(t.id)));

  return { clears, standalone, review, skipped, handledBankIds };
}
