// ─────────────────────────────────────────────────────────────────────────────
// ACCURACY CONTROL TOTALS — the trust layer's THIRD NET (O59 / launch-gate #1).
//
// O60 catches MISSING documents; O49 catches UNSURE classifications. Neither
// catches a CONFIDENTLY-WRONG booking — a high-confidence entry posted to the
// WRONG account (the Riverside "sales-tax-into-revenue" class). This net does:
// independent cross-foots where two figures derived DIFFERENT ways must tie, and
// any mismatch is an ACCURACY FLAG surfaced to the CPA review queue (O50).
//
// Every figure is derived from GL TRUTH (reports.js), never a denormalized flag
// (CLAUDE.md §9). Pure + testable — the app passes in the flattened ledger, the
// reconciliations, the intake rows, and the resolved account codes.
// ─────────────────────────────────────────────────────────────────────────────

import {
  glAccountBalance, computeAR, computeAP, trialBalance, isLiveEntry,
} from "./reports.js";
import { fmtMoney } from "./format.js";

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const glIsRevenueCode = (c) => String(c || "")[0] === "4";
const baseEntryId = (id) => String(id == null ? "" : id).split("_")[0];

// Sum the captured sales tax across live REVENUE-bearing entries — ONCE per entry
// (multi-line rows share one import_metadata). This is INDEPENDENT of how the tax
// was booked, so if the tax leg was mis-posted to revenue, this still reports the
// tax the invoice charged while the GL Sales-Tax-Payable shows short → a mismatch.
function taxChargedOnInvoices(invoices = []) {
  const seen = new Set();
  let total = 0;
  for (const i of invoices) {
    if (!isLiveEntry(i)) continue;
    const tax = Number(i && i.import_metadata && i.import_metadata.tax_amount) || 0;
    if (tax <= 0) continue;
    const base = baseEntryId(i.id);
    if (seen.has(base)) continue;   // one tax figure per journal entry
    seen.add(base);
    total += tax;
  }
  return r2(total);
}

// One control-total check. `ties` when the two independently-derived figures agree
// within tolerance. `severity: "high"` because a non-tie means the books are wrong.
function check(key, label, a, aLabel, b, bLabel, { tolerance = 0.02, ...extra } = {}) {
  const diff = r2(Number(a) - Number(b));
  return {
    key, label, severity: "high",
    a: r2(a), aLabel, b: r2(b), bLabel, diff, tolerance,
    ties: Math.abs(diff) <= tolerance,
    ...extra,
  };
}

// Build the accuracy flag surfaced to the O50 queue for a non-tying control.
function toAccuracyFlag(c) {
  return {
    kind: "accuracy",
    key: c.key,
    severity: "high",
    title: c.label,
    // Plain-English, no debit/credit jargon (Cardinal Principle).
    description: `These should match but don't: ${c.aLabel} is ${money(c.a)}, ${c.bLabel} is ${money(c.b)} — off by ${money(Math.abs(c.diff))}.`,
    a: c.a, b: c.b, diff: c.diff, amount: Math.abs(c.diff),
    ...(c.recId ? { reconciliation_id: c.recId } : {}),
  };
}
const money = (n) => fmtMoney(n);   // canonical magnitude cents (guard-compliant)

// ── THE CONTROL TOTALS ───────────────────────────────────────────────────────
// Returns { checks[], failed[], flags[], allTie }. `codes` = resolved account codes
// (from getAccountByRole): { ar, ap, salesTax }.
export function computeControlTotals({
  invoices = [], reconciliations = [], intakeRows = [],
  codes = {}, now = new Date(),
} = {}) {
  const live = (invoices || []).filter(isLiveEntry);
  const checks = [];

  // 1. AR sub-ledger (sum of open receivables) === GL Accounts Receivable balance.
  if (codes.ar) {
    const arSub = computeAR(invoices, { now }).total;
    const arGl = glAccountBalance(codes.ar, invoices);
    checks.push(check("ar_tie", "Money owed to you (receivables)", arSub, "sum of open invoices", arGl, "receivables account balance"));
  }

  // 2. AP sub-ledger (sum of open bills) === GL Accounts Payable balance.
  if (codes.ap) {
    const apSub = computeAP(invoices, { now }).total;
    const apGl = glAccountBalance(codes.ap, invoices);
    checks.push(check("ap_tie", "Money you owe (payables)", apSub, "sum of open bills", apGl, "payables account balance"));
  }

  // 3. Trial balance: total debits === total credits (the fundamental tie-out).
  const tb = trialBalance(invoices);
  checks.push(check("trial_balance", "Books balance (every entry has two equal sides)", tb.totalDebit, "total on one side", tb.totalCredit, "total on the other", { tolerance: 0.005 }));

  // 4. Sales tax: tax the invoices charged === GL Sales-Tax-Payable balance.
  //    THE Riverside catch — tax booked into revenue leaves the liability short.
  //    (Holds until sales-tax remittance ships (O6); a remittance lowers the GL, so
  //    once remittance exists this becomes charged − remitted. Noted.)
  if (codes.salesTax) {
    const taxCharged = taxChargedOnInvoices(live);
    const taxGl = glAccountBalance(codes.salesTax, invoices);
    checks.push(check("sales_tax_tie", "Sales tax set aside", taxCharged, "tax charged on invoices", taxGl, "sales tax owed (liability)"));
  }

  // 5. Cash cleared === bank-reconciled cleared total (for each completed reconciliation).
  for (const rec of reconciliations || []) {
    if (!rec || rec.status !== "complete") continue;
    const books = Number(rec.books_balance) || 0;
    const stmt = Number(rec.statement_balance) || 0;
    const label = `Bank match — ${rec.account_name || "account"}${rec.period_end ? ` (through ${rec.period_end})` : ""}`;
    checks.push(check("cash_recon", label, books, "your books", stmt, "the bank statement", { recId: rec.id }));
  }

  // 6. Documents recorded (O60 intake) === journal entries created for them. A doc
  //    marked RECORDED that has NO linked entry is a false-success (claimed booked,
  //    nothing posted). Compares recorded count vs recorded-with-an-entry count.
  const recorded = (intakeRows || []).filter((r) => r && r.status === "recorded");
  const recordedWithEntry = recorded.filter((r) => Array.isArray(r.journal_entry_ids) && r.journal_entry_ids.length > 0);
  if (recorded.length) {
    checks.push(check("docs_recorded", "Every document marked booked has an entry", recorded.length, "documents booked", recordedWithEntry.length, "with an entry behind them", { tolerance: 0 }));
  }

  const failed = checks.filter((c) => !c.ties);
  return { checks, failed, flags: failed.map(toAccuracyFlag), allTie: failed.length === 0 };
}

// ── SIGN-OFF EVALUATION (O50 attestation gate) ───────────────────────────────
// A CPA can mark a period "reviewed" ONLY when all three nets are clear:
//   completeness (O60) — no dropped/stuck documents,
//   confidence (O49)   — no unresolved low-confidence flags,
//   accuracy (this net)— every control total ties.
// Returns { ok, blockers:[{ net, reason }] }. If ANY net is unresolved, sign-off is
// BLOCKED with the reason — never a green light on unverified books.
export function evaluateSignOff({ controlTotals = { failed: [], allTie: true }, openConfidenceFlags = [], droppedDocs = [], unknownDocs = [] } = {}) {
  const blockers = [];
  const dropped = (droppedDocs || []).length;
  const unknown = (unknownDocs || []).filter((d) => d && !d.posted).length;
  if (dropped + unknown > 0) {
    blockers.push({ net: "completeness", reason: `${dropped + unknown} document${dropped + unknown === 1 ? "" : "s"} not yet accounted for` });
  }
  const flags = (openConfidenceFlags || []).length;
  if (flags > 0) {
    blockers.push({ net: "confidence", reason: `${flags} transaction${flags === 1 ? "" : "s"} still awaiting review` });
  }
  const failed = (controlTotals.failed || []);
  if (failed.length > 0) {
    blockers.push({ net: "accuracy", reason: `${failed.length} check${failed.length === 1 ? "" : "s"} that should match don't: ${failed.map((f) => f.label).join("; ")}` });
  }
  return { ok: blockers.length === 0, blockers };
}

// ── BANK-MATCH FRESHNESS (the SINGLE source for "are the books matched to the bank?") ────
// The control-totals `cash_recon` check only compares reconciliations that EXIST and are
// complete — so a company that has NEVER reconciled (or hasn't in a long time) produces no
// FAILED check and reads as "clear." That's a blind spot: absent reconciliation ≠ reconciled.
// This derives the SAME "matched / not matched" signal the dashboard bank-match reminder uses,
// as ONE pure function both surfaces call — so the owner panel and the dashboard alert can
// never contradict. "Matched" = a completed reconciliation exists AND is recent (≤ staleDays);
// never-reconciled (days === null) or stale counts as NOT matched. Only relevant once there are
// real books (a non-voided entry), so a brand-new empty company isn't nagged.
export function bankMatchStatus({ reconciliations = [], invoices = [], now = new Date(), staleDays = 35 } = {}) {
  const completed = (reconciliations || []).filter((r) => r && r.status === "complete");
  let lastCompletedAt = null;
  for (const r of completed) {
    const t = r.completed_at;
    if (t && (lastCompletedAt === null || String(t) > String(lastCompletedAt))) lastCompletedAt = t;
  }
  const days = lastCompletedAt ? Math.floor((+new Date(now) - +new Date(lastCompletedAt)) / 86400000) : null;
  const hasBooks = (invoices || []).some((i) => i && i.status !== "voided");
  const everReconciled = completed.length > 0;
  const overdue = hasBooks && (days === null || days > staleDays);   // == the dashboard reminder's condition
  return { overdue, days, hasBooks, everReconciled, lastCompletedAt };
}

// ── SIGN-OFF READINESS — the authoritative "can this period be attested?" gate ────────────
// The FOUR nets: the three from evaluateSignOff (completeness / confidence / accuracy) PLUS
// bank-match (C159 — don't attest a period whose cash isn't matched to the bank). One pure
// function so the write path (signOffPeriod) and the CPA UI can't gate differently. Returns
// { ok, blockers:[{net, reason}] }. CPA-side, so blocker reasons may use accounting terms.
export function signOffReadiness({ controlTotals = { failed: [], allTie: true }, openConfidenceFlags = [], droppedDocs = [], unknownDocs = [], bankMatch = { overdue: false, days: null } } = {}) {
  const evalr = evaluateSignOff({ controlTotals, openConfidenceFlags, droppedDocs, unknownDocs });
  const blockers = [...evalr.blockers];
  if (bankMatch && bankMatch.overdue) {
    blockers.push({ net: "bank", reason: `the bank isn't reconciled yet${bankMatch.days != null ? ` (${bankMatch.days} days)` : ""} — match the latest statement first` });
  }
  return { ok: blockers.length === 0, blockers };
}
