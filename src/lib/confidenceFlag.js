// ─────────────────────────────────────────────────────────────────────────────
// AI confidence + flag-when-unsure (O49) — the review-burden REDUCER.
//
// Where O60 (completeness) catches docs that fell through, O49 flags PROCESSED
// transactions the AI wasn't confident about, so a reviewing CPA looks only at what
// needs a human — not everything. The cardinal rule: flag when GENUINELY UNCERTAIN
// **and** it MATERIALLY affects the books. Over-flagging is as useless as no flagging.
//
// Confidence is already captured + stored on every AI-categorized entry
// (journal_entries.ai_confidence; flatten exposes it as `confidence`). So the flag is
// DERIVED here from confidence + amount — no denormalized flag column, no migration
// (mirrors the GL-truth "derive, don't store a stale flag" principle, CLAUDE.md §9).
// ─────────────────────────────────────────────────────────────────────────────

import { fmtMoney } from "./format";

// Tunable thresholds. Confidence is 0–100 (the model's scale; rule-applied = 99).
export const FLAG_DEFAULTS = {
  reviewThreshold: 75,    // below this = "uncertain"
  hardFloor: 50,          // below this = genuinely unsure → flag once non-trivial
  minAmount: 50,          // below this $ = immaterial → never flag (noise reduction)
  materiality: 1000,      // at/above this $, uncertainty matters
  highMateriality: 5000,  // very large → flag even at MODERATE uncertainty / escalate severity
};

const num = (n) => Number(n) || 0;
const money = (n) => fmtMoney(n);   // canonical magnitude cents (was ad-hoc whole-dollar)
const sevRank = (s) => (s === "high" ? 2 : s === "medium" ? 1 : 0);

// THE FLAG RULE (pure, deterministic, tunable). Returns { flagged, reason, severity, confidence }.
// A missing confidence is treated as fully-confident (100) so unscored/mechanical entries
// (settlements, opening balances) are NOT flagged — only entries the AI actually scored low.
export function shouldFlagForReview(txn = {}, opts = {}) {
  const t = { ...FLAG_DEFAULTS, ...opts };
  const conf = txn.confidence == null ? 100 : num(txn.confidence);
  const amt = Math.abs(num(txn.amount));
  const none = { flagged: false, reason: null, severity: "low", confidence: conf };

  if (txn.status === "voided" || txn.status === "deleted") return none;
  if (amt < t.minAmount) return none;                       // immaterial — never flag, whatever the confidence

  // 1) Genuinely unsure → flag once the amount is non-trivial.
  if (conf < t.hardFloor) {
    return { flagged: true, confidence: conf, severity: amt >= t.materiality ? "high" : "medium",
      reason: `Very low confidence (${conf}%) — the AI was genuinely unsure how to categorize this${amt >= t.materiality ? ` on a material amount (${money(amt)})` : ""}.` };
  }
  // 2) Uncertain AND material → the core "needs a human look" case.
  if (conf < t.reviewThreshold && amt >= t.materiality) {
    return { flagged: true, confidence: conf, severity: amt >= t.highMateriality ? "high" : "medium",
      reason: `Uncertain (${conf}%) on a material amount (${money(amt)}) — worth a quick human check.` };
  }
  // 3) Very large amount with ANY less-than-high confidence → materiality dominates.
  if (amt >= t.highMateriality && conf < 90) {
    return { flagged: true, confidence: conf, severity: "high",
      reason: `Large amount (${money(amt)}) booked with less-than-high confidence (${conf}%).` };
  }
  // Confident, or immaterial-enough uncertainty → no flag (this is what keeps it SELECTIVE).
  return none;
}

// The queryable "needs review" SET (what O50's CPA surface will consume). Each item carries
// the AI's CHOSEN account, its CONFIDENCE, the WHY (reasoning — ties C107/C109), any
// ALTERNATIVES the model considered, plus the flag reason + severity. Most material / least
// confident first — the order a CPA should work them.
export function flaggedForReview(invoices = [], opts = {}) {
  const out = [];
  for (const i of (invoices || [])) {
    if (!i || i.status === "voided" || i.status === "deleted") continue;
    const a = shouldFlagForReview(i, opts);
    if (!a.flagged) continue;
    out.push({
      id: i.id,
      db_entry_id: i.db_entry_id ?? null,
      vendor: i.vendor ?? null,
      description: i.description ?? null,
      date: i.date ?? null,
      amount: num(i.amount),
      gl_code: i.gl_code ?? null,                                   // the AI's chosen account
      gl_name: i.gl_name ?? null,
      confidence: a.confidence,
      severity: a.severity,
      reason: a.reason,                                             // WHY it's flagged
      reasoning: i.reasoning || null,                               // WHY this account (the classification rationale)
      alternatives: Array.isArray(i.alternatives) ? i.alternatives : [],  // accounts considered, when captured
    });
  }
  out.sort((x, y) => (sevRank(y.severity) - sevRank(x.severity)) || (Math.abs(y.amount) - Math.abs(x.amount)));
  return out;
}

// Convenience summary for a dashboard/CPA-surface badge (count + total $ exposed to review).
export function reviewSummary(invoices = [], opts = {}) {
  const flags = flaggedForReview(invoices, opts);
  return {
    count: flags.length,
    high: flags.filter(f => f.severity === "high").length,
    total_amount: Math.round(flags.reduce((s, f) => s + Math.abs(f.amount), 0) * 100) / 100,
    flags,
  };
}

// Fallback confidence DERIVATION for paths where the model didn't return a score (part 1
// "OR derive from signals"). The primary path uses the model's confidence; this only kicks in
// when it's absent, so a signal-poor extraction still gets a sensible (lower) score.
export function deriveConfidence(txn = {}, { hasRule = false, hasHistory = false } = {}) {
  if (txn.rule_applied || hasRule) return 99;                      // matched a vendor rule → high
  let c = 80;
  const vendor = String(txn.vendor || "").trim();
  if (!vendor || vendor.length < 3) c -= 25;                       // ambiguous / missing vendor
  if (!txn.gl_code) c -= 30;                                       // no account chosen
  if (!hasHistory) c -= 5;                                         // no prior history for this vendor
  return Math.max(5, Math.min(99, c));
}
