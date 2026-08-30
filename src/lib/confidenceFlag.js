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
import { AI_CONFIDENCE_ASK_FLOOR } from "./constants";

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

// THE CLARIFICATION GATE (pure) — "book it, or ask?" for the upload flow. A real bookkeeper
// books what they're confident about and asks about the rest. Two reasons to ASK:
//   1) BELOW the hard confidence floor (askFloor) — too close to a coin-flip to book silently,
//      regardless of materiality. Auto-booking a coin-flip erodes trust and poisons the
//      learning layer, so this is a floor, not a suggestion.
//   2) O49 flags it (genuinely uncertain AND material) — the materiality-gated zone above the
//      floor, delegated to shouldFlagForReview.
// Missing amount → can't book, so ask. Returns { autoBook, reason }.
// NOTE: an explicit vendor RULE and the learned-vendor confidence boost are applied by the
// caller BEFORE this (they raise confidence / short-circuit), so a known vendor books through.
// ── TIER 1 #7 — "MISCELLANEOUS ON A RECOGNISABLE VENDOR IS A HARD FAIL" ─────
// The joint acceptance test for cold start, verbatim from the roadmap: *the first document
// a new signup uploads books correctly OR asks a smart question* — never a silent wrong
// bucket. `7100 Miscellaneous` and `7150 Uncategorized` are the two buckets that mean
// "we could not tell", and **a confident booking into a bucket that means uncertainty is a
// contradiction in terms.**
//
// ★ THE LIVE SPECIMEN: `Alamo Ice & Beverage` — CO2 tanks and bagged ice, a vendor any
// human reads at a glance — auto-booked to `7100`. Nothing about that was low-confidence
// enough to trip the floor, because the model was confident about the WRONG THING: it was
// sure it did not know.
//
// ▶ IT BLOCKS AUTO-BOOKING, NOT BOOKING. The entry is still recorded — a fact still books
// (Rule 1) — it just goes to the human with the question instead of past them. And it is
// scoped to a vendor we can NAME: an unnamed line genuinely has nothing better available,
// and asking about it would be the noise `O122` forbids.
const CATCH_ALL_ROLES = new Set(["miscellaneous_expense", "uncategorized_expense"]);
const CATCH_ALL_CODES = new Set(["7100", "7150"]);

export function isCatchAllAccount({ gl_code = null, gl_name = null, system_role = null } = {}) {
  if (system_role && CATCH_ALL_ROLES.has(String(system_role))) return true;
  if (gl_code && CATCH_ALL_CODES.has(String(gl_code).trim())) return true;
  // Name-based fallback for a renumbered chart — the words themselves are the signal.
  return /\b(miscellaneous|uncategori[sz]ed)\b/i.test(String(gl_name || ""));
}

// Do we know who this is? A name with letters in it is a vendor a human could look up.
export function hasNamedVendor(txn = {}) {
  const v = String(txn.vendor || "").trim();
  return v.length >= 3 && /[a-z]{3}/i.test(v);
}

export function autoBookDecision(txn = {}, { askFloor = AI_CONFIDENCE_ASK_FLOOR, ...opts } = {}) {
  const conf = txn.confidence == null ? 100 : num(txn.confidence);
  if (!(Math.abs(num(txn.amount)) > 0)) return { autoBook: false, reason: "missing_amount" };
  if (conf < askFloor) return { autoBook: false, reason: "below_confidence_floor" };
  // ★★ A CONFIDENT BOOKING INTO A BUCKET THAT MEANS "WE COULDN'T TELL" IS A CONTRADICTION.
  // Checked AFTER the floor so the reason is the most specific true one, and BEFORE the
  // materiality flag so a small Miscellaneous booking is caught too — the hard-fail test
  // says nothing about the amount.
  if (isCatchAllAccount(txn) && hasNamedVendor(txn)) {
    return { autoBook: false, reason: "catch_all_account_named_vendor" };
  }
  if (shouldFlagForReview(txn, opts).flagged) return { autoBook: false, reason: "flagged_uncertain_material" };
  return { autoBook: true, reason: "confident" };
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
