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
// Deterministic high-confidence matcher (runs BEFORE the LLM pass). Pairs a bank line
// to an open item by NORMALIZED party name (LLC/Inc + parentheticals stripped) + EXACT
// amount. The CLEAR SIDE is keyed on the open item's A/R or A/P OFFSET GL CODE — NOT on
// a `type` string. (The earlier `type === "revenue"/"expense"` filter was the silent
// killer: an item whose flattened/categorized `type` drifted from those exact strings
// vanished from the candidate set, so a payable or a 4100-revenue invoice never matched
// even with an identical name + exact amount. The AR/AP account code is the reliable
// anchor; the bank line's revenue/expense `type` is only a soft direction PREFERENCE,
// relaxed when the line carries no usable hint.) Symmetric across A/R and A/P; each open
// item clears at most once (greedy). Returns autoCleared-shaped records carrying
// bank_txn + bank_txn_id so planBankImport excludes them from standalone booking.
// ─────────────────────────────────────────────────────────────────────────────
export function autoMatchBankLines(parsedTxns = [], openItems = [], { amountTolerance = 0.01, arCode, apCode, trace } = {}) {
  // Robust amount coercion: real AI-categorized amounts can arrive as "$4,500.00" or
  // "4,500" strings; a bare Number() yields NaN → the line is silently skipped → matching
  // collapses to zero. Strip currency/grouping first.
  const num = (v) => { if (v == null) return NaN; const n = Number(String(v).replace(/[$,\s]/g, "")); return Number.isFinite(n) ? Math.abs(n) : NaN; };
  const eq = (a, b) => a != null && b != null && String(a) === String(b);
  // An open item is a RECEIVABLE if its A/R account appears on either leg; PAYABLE if A/P.
  // When the caller supplies the A/R / A/P codes (production), key STRICTLY on them — the
  // reliable anchor, and it excludes prior direct-booked Dr Cash/Cr Rev entries (offset =
  // Cash, not A/R) from being mistaken for open receivables. Only when no codes are given
  // (legacy callers) fall back to the `type` string.
  const itemAR = (i) => arCode != null ? (eq(i.secondary_gl_code, arCode) || eq(i.gl_code, arCode)) : i.type === "revenue";
  const itemAP = (i) => apCode != null ? (eq(i.secondary_gl_code, apCode) || eq(i.gl_code, apCode)) : i.type === "expense";
  const used = new Set();   // an open item may clear only once
  const matches = [];
  const note = (rec) => { if (trace) trace.push(rec); };
  for (const t of parsedTxns || []) {
    const amt = num(t.amount);
    if (!amt) { note({ bank: t.id, vendor: t.vendor, amount: t.amount, matched: false, reason: "unparseable amount" }); continue; }
    const partyNorm = normalizeName(t.vendor || t.description);
    if (!partyNorm || partyNorm.length < 2) { note({ bank: t.id, vendor: t.vendor, amount: amt, matched: false, reason: "no usable party name" }); continue; }
    // Soft direction hint from the bank line's category (deposit→AR, payment→AP). Only a
    // preference: if the hint finds nothing we relax and let the matched item's offset decide.
    const wantsAR = t.type === "revenue";
    const wantsAP = t.type === "expense";
    const matchesItem = (i, respectHint) => {
      if (used.has(String(i.id))) return false;
      const ar = itemAR(i), ap = itemAP(i);
      if (!ar && !ap) return false;                    // only ever clear a real A/R or A/P open item
      if (respectHint && wantsAR && !ar) return false; // a deposit shouldn't pay a bill, and vice-versa
      if (respectHint && wantsAP && !ap) return false;
      // A TAXED A/R invoice's revenue row carries ex-tax `amount` but the bank deposit equals
      // the FULL receivable, exposed as `ar_amount`. Match against ANY known amount.
      const iAmts = [i.ar_amount, i.balance_remaining, i.amount].map(num).filter(v => v > 0);
      if (!iAmts.some(v => Math.abs(v - amt) <= amountTolerance)) return false;
      const iNorm = normalizeName(i.vendor);
      if (!iNorm || iNorm.length < 2) return false;
      // Substring either direction so a parenthetical/suffix on either side still matches.
      return iNorm === partyNorm || iNorm.includes(partyNorm) || partyNorm.includes(iNorm);
    };
    // Prefer a hint-consistent match; relax to either side only when the line had no hint.
    let cand = (openItems || []).find((i) => matchesItem(i, true));
    if (!cand && !wantsAR && !wantsAP) cand = (openItems || []).find((i) => matchesItem(i, false));
    if (!cand) {
      // Per-line reason for the [bank-match] results log — progressively relax the criteria
      // to pinpoint WHICH one excluded every candidate (so a live miss is self-explaining).
      if (trace) {
        const arap = (openItems || []).filter((i) => itemAR(i) || itemAP(i));
        const unused = arap.filter((i) => !used.has(String(i.id)));
        const amtOk = unused.filter((i) => [i.ar_amount, i.balance_remaining, i.amount].map(num).filter((v) => v > 0).some((v) => Math.abs(v - amt) <= amountTolerance));
        const nameOk = amtOk.filter((i) => { const n = normalizeName(i.vendor); return n && (n === partyNorm || n.includes(partyNorm) || partyNorm.includes(n)); });
        let reason;
        if (arap.length === 0) reason = "no A/R or A/P open items in the candidate set";
        else if (unused.length === 0) reason = "all A/R/A/P candidates already taken by earlier lines";
        else if (amtOk.length === 0) reason = `no candidate amount ≈ ${amt} (open A/R-A/P amounts: ${unused.map((i) => num(i.amount)).join(", ")})`;
        else if (nameOk.length === 0) reason = `amount matched but name "${partyNorm}" ≠ [${amtOk.map((i) => `"${normalizeName(i.vendor)}"`).join(", ")}]`;
        else reason = `name+amount matched ${nameOk.map((i) => i.id).join(",")} but the ${wantsAR ? "deposit→A/R" : wantsAP ? "payment→A/P" : "side"} hint excluded it`;
        note({ bank: t.id, vendor: t.vendor, amount: amt, type: t.type, matched: false, reason });
      }
      continue;
    }
    used.add(String(cand.id));
    const side = itemAR(cand) ? "ar" : "ap";
    note({ bank: t.id, vendor: t.vendor, amount: amt, matched: true, invoiceId: String(cand.id), side });
    matches.push({
      bank_txn_id: t.id,
      bank_txn: t,
      invoice_ids: [String(cand.id)],
      match_type: side === "ar" ? "ar_clear" : "ap_clear",
      confidence: 99,
      amount_matched: amt,
      amount_remaining: 0,
      auto_clear: true,
      deterministic: true,
      reasoning: `Exact amount $${amt.toFixed(2)} + party "${cand.vendor}" ≈ "${t.vendor || t.description}" (clears ${side.toUpperCase()})`,
    });
  }
  return matches;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build the OPEN-ITEM candidate set the matcher runs against — from GL TRUTH, not a
// payment_status flag. (The 1-of-3 contamination: the old filter excluded anything
// flagged "collected"/"paid", and the three invoices WITH bank lines carried those flags
// from prior rounds whose clearing JEs were later reversed/soft-deleted — restoring the
// A/R-A/P balance but leaving the stale flag. Only the no-bank-line invoice, never
// matched, kept a clean flag and survived → exactly the live candidates: Array(1).)
//
// An A/R or A/P item is SETTLED only when a LIVE clearing JE links to it
// (import_metadata.payment_for === its entry id). No live link → still open, whatever the
// flag says. This is built BEFORE the current import books anything, so it reflects the
// pristine pre-import ledger. Returns only clearable (A/R / A/P / accrued) items.
// ─────────────────────────────────────────────────────────────────────────────
export function matchableOpenItems(invoices = [], { arCode, apCode, accruedCode } = {}) {
  const eq = (a, b) => a != null && b != null && String(a) === String(b);
  const codeOnLeg = (i, code) => code != null && (eq(i.secondary_gl_code, code) || eq(i.gl_code, code));
  const isClearable = (i) => codeOnLeg(i, arCode) || codeOnLeg(i, apCode) || codeOnLeg(i, accruedCode);
  // Bills/invoices that a LIVE (non-voided, non-deleted) clearing JE already settled.
  const cleared = new Set(
    (invoices || [])
      .filter(i => i && i.import_metadata && i.import_metadata.payment_for != null && i.status !== "voided" && !i.deleted_at)
      .map(i => String(i.import_metadata.payment_for))
  );
  return (invoices || []).filter(i =>
    i &&
    isClearable(i) &&
    i.source !== "bank_feed" && i.source !== "bank_statement" &&   // not the bank lines themselves
    !i.matched &&                                                  // session optimistic guard
    !cleared.has(String(i.db_entry_id != null ? i.db_entry_id : i.id)));
}

// ─────────────────────────────────────────────────────────────────────────────
// PREVIEW = EXECUTOR: derive each bank line's BOOKING FATE from the SAME planBankImport
// result the booking will use, so the review screen shows exactly what will be booked.
// (The drift this fixes: the review table rendered the AI's per-line categorization —
// "Service Revenue", "Professional Services" — for lines that actually book as A/R / A/P
// CLEARINGS, because matching only ran at Book time. A user could distrust or cancel the
// import based on a wrong preview.) Returns { [bankId]: { fate, side, clears…, label } }
// where fate ∈ "clear_ar" | "clear_ap" | "review" | "direct".
// ─────────────────────────────────────────────────────────────────────────────
export function bankLineFates(parsedTxns = [], plan = {}, openItems = []) {
  const fates = {};
  const invById = new Map((openItems || []).map((i) => [String(i.id), i]));
  for (const c of plan.clears || []) {
    const inv = invById.get(String(c.invoiceId));
    fates[String(c.bankId)] = {
      fate: c.side === "ar" ? "clear_ar" : "clear_ap",
      side: c.side,
      clearsInvoiceId: String(c.invoiceId),
      clearsVendor: (inv && inv.vendor) || null,
      clearsAmount: (c.entry && c.entry.amount != null) ? c.entry.amount : (inv && inv.amount) || null,
      label: c.side === "ar"
        ? `Clears A/R — ${(inv && inv.vendor) || "receivable"}`
        : `Clears A/P — ${(inv && inv.vendor) || "payable"}`,
    };
  }
  for (const m of plan.review || []) {
    const bid = (m.bank_txn && m.bank_txn.id != null) ? m.bank_txn.id : m.bank_txn_id;
    if (bid != null && !fates[String(bid)]) fates[String(bid)] = { fate: "review", label: "Needs review (uncertain match)" };
  }
  for (const t of parsedTxns || []) {
    if (!fates[String(t.id)]) fates[String(t.id)] = { fate: "direct", label: null };   // books as categorized
  }
  return fates;
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
// The plain-language CLASSIFICATION reason for a bank line — WHY it was booked to this GL
// account (vendor + signal → account), for the transaction-detail "AI reasoning". Prefers the
// categorizer's reasoning; otherwise builds one from the vendor + chosen account. Never the
// provenance ("imported from bank statement"), which is redundant with `source`/the UI.
export function classifyBankReason(txn = {}) {
  const r = txn && txn.reasoning && String(txn.reasoning).trim();
  if (r) return r;
  const acct = txn.gl_name ? `${txn.gl_name}${txn.gl_code ? ` (${txn.gl_code})` : ""}` : (txn.gl_code || "this account");
  const who = txn.vendor || txn.description;
  return who ? `Categorized to ${acct} based on "${who}".` : `Categorized to ${acct}.`;
}

export function buildBankLineEntry(txn, { offsetCode = "1000", offsetName = "Cash" } = {}) {
  const amount = Math.abs(Number(txn && txn.amount) || 0);
  const date = (txn && txn.date) || null;
  const isRevenue = txn && txn.type === "revenue";
  // The `reasoning` field must explain the GL CLASSIFICATION (why this account), NOT the
  // provenance ("imported from bank statement" — that's already shown via `source`/the UI).
  // Prefer the categorizer's reason; else a real classification fallback (vendor → account).
  return {
    vendor: txn && txn.vendor, description: txn && txn.description, amount, date,
    type: txn && txn.type, project: "General",
    gl_code: txn && txn.gl_code, gl_name: txn && txn.gl_name,
    secondary_gl_code: offsetCode, secondary_gl_name: offsetName,
    debit_credit: isRevenue ? "credit" : "debit",
    confidence: txn && txn.confidence,
    reasoning: classifyBankReason(txn),
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
