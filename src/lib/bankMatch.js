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

// True only for A/R match types ("ar_clear", "partial_ar"). A naive
// `.includes("ar")` is WRONG — "ap_clear" and "partial_ap" both contain "ar".
export function isArMatch(matchType) {
  const t = String(matchType || "");
  return t.startsWith("ar") || t.endsWith("_ar");
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
    const bankId = m.bank_txn?.id != null ? String(m.bank_txn.id) : null;
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
  for (const m of review) if (m.bank_txn?.id != null) handledBankIds.add(String(m.bank_txn.id));

  const standalone = (parsedTxns || []).filter((t) => !handledBankIds.has(String(t.id)));

  return { clears, standalone, review, skipped, handledBankIds };
}
