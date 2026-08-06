// ════════════════════════════════════════════════════════════════════════════
// C198·1 — STATEMENT LIFECYCLE (§11 ★ O86 findings (i)–(l)).
//
// A statement row had exactly ONE path to 'complete': the reconcile-completion
// sweep (C195(2), `statementsCoveredByReconciliation`). The FIRST-PASS path —
// pipeline runs, a human books the leftover exceptions in Bank Import — never
// re-derived the status, so a statement whose work was fully finished sat at
// 'attention' forever, kept its exception card alive, and told Review about a
// problem the books no longer had (O86 (i)/(j), live: June reached 'complete'
// via reconcile; May's rows still dangle).
//
// This module is the pure decision layer for that lifecycle:
//   (i)  when may a statement advance to 'complete'?      → statementAdvanceStatus
//   (j)  what does a re-upload DO to an existing row?     → planStatementReupload
//   (j)  is the statement ready to reconcile right now?   → statementReadyToReconcile
//   (k)  what should a Review card point at / show?       → statementCardState + …Target
//   (l)  what balance does a session start with?          → prefillEndingBalance
//
// NO new statuses are invented: 'complete' is exactly what the reconcile path
// already writes, and 'superseded' stays C193's. NO I/O — App wraps these.
// ════════════════════════════════════════════════════════════════════════════

// A statement LINE is settled when the ledger already holds it: booked directly,
// matched to a clearing, or recognized as already-booked on a re-upload. 'pending'
// and 'excepted' are the two that still owe a human something.
export const SETTLED_LINE_STATUSES = ["booked", "matched", "already_booked"];
export const isSettledLineStatus = (s) => SETTLED_LINE_STATUSES.includes(String(s || ""));

export function unsettledLineCount(lineStatuses = []) {
  return (lineStatuses || []).filter((s) => !isSettledLineStatus(s)).length;
}

// All settled — with the deliberate empty-case rule: a statement with NO lines is
// NOT "all settled". Zero-of-zero is the vacuous-pass class this codebase keeps
// eliminating (O90); an empty statement is a parse that produced nothing, which is
// a problem to look at, never a completion to celebrate.
export function allLinesSettled(lineStatuses = []) {
  const list = lineStatuses || [];
  return list.length > 0 && unsettledLineCount(list) === 0;
}

// ── (i) MAY THIS STATEMENT ADVANCE? ──────────────────────────────────────────
// Returns 'complete' or null (leave it alone). Advancing requires BOTH:
//   • every line settled (no pending, no excepted), AND
//   • nothing outstanding about the BALANCE — either a completed reconciliation
//     covers the period, or the statement's own ending balance nets against the
//     books. A statement whose lines are all booked but whose ending balance
//     doesn't tie is genuinely still an exception; marking it complete would be a
//     false green on the one surface Review trusts.
// Terminal states are never touched: 'complete' is idempotent, 'superseded' is
// C193's and must not be resurrected.
export function statementAdvanceStatus({ status = null, lineStatuses = [], balanceSettled = true } = {}) {
  const s = String(status || "");
  if (s === "complete" || s === "superseded") return null;
  if (!allLinesSettled(lineStatuses)) return null;
  if (!balanceSettled) return null;
  return "complete";
}

// ── (j) WHAT DOES A RE-UPLOAD DO? ────────────────────────────────────────────
// C193 made a re-upload create a fresh run record and RETIRE the older same-content
// rows. That is right for a FINISHED statement. For a non-complete one it meant the
// re-upload changed nothing anyone could see — the stale 'attention' survived and
// kept lying to Review (O86 (j)).
//
//   existing.status 'complete'   → supersede, exactly as today (regression-locked)
//   existing.status 'superseded' → treat as absent; the newer row owns the story
//   anything else                → RE-EVALUATE against the current ledger
//
// `advanceTo` is what the re-evaluation should write (null = still has open work),
// `offerReconcile` is whether the CPA should be handed a ready session instead of
// being asked for the file a third time.
export function planStatementReupload({ existing = null, lineStatuses = [], balanceSettled = true } = {}) {
  if (!existing || !existing.id) return { action: "new", reevaluate: false, advanceTo: null, offerReconcile: false, unresolved: 0 };
  const status = String(existing.status || "");
  if (status === "superseded") return { action: "new", reevaluate: false, advanceTo: null, offerReconcile: false, unresolved: 0 };
  if (status === "complete") {
    // Unchanged C193 behavior — a finished statement is superseded, never re-run.
    return { action: "supersede", reevaluate: false, advanceTo: null, offerReconcile: false, unresolved: 0 };
  }
  const settled = allLinesSettled(lineStatuses);
  return {
    action: "reevaluate",
    reevaluate: true,
    advanceTo: statementAdvanceStatus({ status, lineStatuses, balanceSettled }),
    // The reconcile offer is about the LINES being done. A balance that doesn't tie
    // is precisely what the reconcile session exists to sort out, so it must not
    // suppress the offer — only the status advance.
    offerReconcile: settled,
    unresolved: unsettledLineCount(lineStatuses),
  };
}

// Does a COMPLETED reconciliation already cover this statement's account + period?
// Mirrors `statementsCoveredByReconciliation`'s containment rule (statement period
// inside the reconciled period), read from the reconciliation side.
export function reconciliationCoversStatement(reconciliations = [], statement = {}) {
  const ps = String(statement && statement.period_start || "");
  const pe = String(statement && statement.period_end || "");
  if (!ps && !pe) return false;
  return (reconciliations || []).some((r) => {
    if (!r || String(r.status) !== "complete") return false;
    const acct = statement && statement.bank_account_id;
    if (acct && r.account_id && String(r.account_id) !== String(acct)) return false;
    const rs = String(r.period_start || ""), re = String(r.period_end || "");
    if (!rs || !re) return false;
    return (!ps || ps >= rs) && (!pe || pe <= re);
  });
}

// ── (j) READY TO RECONCILE ───────────────────────────────────────────────────
// Every line is in the ledger and nobody has reconciled the period yet → the honest
// next step is a reconciliation the system OFFERS, not a third upload it demands.
export function statementReadyToReconcile({ statement = {}, lineStatuses = [], reconciliations = [] } = {}) {
  if (!statement || !statement.id) return false;
  if (String(statement.status) === "superseded") return false;
  if (!allLinesSettled(lineStatuses)) return false;
  return !reconciliationCoversStatement(reconciliations, statement);
}

// ── (k) WHAT THE REVIEW CARD SHOULD BE ───────────────────────────────────────
//   "exception" — real unfinished work (unsettled lines, or a balance that hasn't
//                 been sorted out); render the card.
//   "ready"     — lines all in the ledger, period not reconciled: this is not a
//                 problem, it's an invitation. Render it as "ready to reconcile".
//   "none"      — resolved (reconciled, superseded, or already complete). Render
//                 NOTHING; a card describing a finished state is a lie with a button.
export function statementCardState({ statement = {}, lineStatuses = [], reconciliations = [] } = {}) {
  const status = String(statement && statement.status || "");
  if (!statement || !statement.id) return "none";
  if (status === "superseded" || status === "complete") return "none";
  if (reconciliationCoversStatement(reconciliations, statement)) return "none";
  if (!allLinesSettled(lineStatuses)) return "exception";
  return "ready";
}

// Where a statement-level card must send the reviewer. A LINE-level exception is
// still Bank Import's job (that's where a single line gets categorized and booked).
// A STATEMENT-level one is about the whole period's balance — Bank Import renders an
// EMPTY screen for it once the lines are booked (the live O86 (k) dead end), so it
// goes to Reconcile, carrying the account + period so the session opens on the right
// month instead of making the CPA re-pick it.
export function statementExceptionTarget(item = {}) {
  if (!item || item.kind !== "statement") return { view: "bank" };
  return {
    view: "recon",
    statementId: item.statement_id != null ? String(item.statement_id) : null,
    accountId: item.bank_account_id != null ? String(item.bank_account_id) : null,
    periodStart: item.period_start || null,
    periodEnd: item.period_end || null,
  };
}

// ── (l) ENDING-BALANCE PREFILL ───────────────────────────────────────────────
// The statement's stated ending balance is ALREADY persisted (C185
// `bank_statements.stated_ending_balance`), yet the completion bar made the CPA
// hand-type it (O86 (l)). Prefill it — but ONLY into an empty field. That single
// rule is what keeps it the CPA's independent check: once they type anything, the
// entered value governs and no later prefill may overwrite it.
export function prefillEndingBalance({ statement = null, current = "" } = {}) {
  if (current != null && String(current) !== "") return null;      // an entered value always wins
  const v = statement && statement.stated_ending_balance;
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return String(n);
}

// The newest LIVE statement for an account + month — what a session should open with.
// Newest wins (a re-upload's row is the current one); superseded rows are invisible.
export function statementForPeriod(statements = [], { accountId = null, periodStart = null, periodEnd = null } = {}) {
  const inWindow = (s) => {
    const ps = String(s.period_start || ""), pe = String(s.period_end || "");
    if (!ps && !pe) return false;
    return (!periodStart || !ps || ps >= String(periodStart)) && (!periodEnd || !pe || pe <= String(periodEnd));
  };
  const matches = (statements || []).filter((s) => {
    if (!s || String(s.status) === "superseded") return false;
    if (accountId && accountId !== "manual" && String(s.bank_account_id) !== String(accountId)) return false;
    return inWindow(s);
  });
  if (!matches.length) return null;
  return matches.slice().sort((a, b) => {
    const t = String(b.created_at || "").localeCompare(String(a.created_at || ""));
    return t !== 0 ? t : String(b.id).localeCompare(String(a.id));
  })[0];
}

// Copy — plain language, no accounting concepts (Cardinal Principle / standing directive).
export const READY_TO_RECONCILE_COPY = "Everything on this statement is in your books — the last step is checking it against your bank.";
export const OPEN_RECONCILE_LABEL = "Check it against the bank →";
export const STATEMENT_COMPLETED_AUDIT = "statement_completed_first_pass";
