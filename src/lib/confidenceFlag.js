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
import { collapseExpandedRows, listAmount } from "./txnPresent.js";
import { glIsRevenue, glIsExpense } from "./gl.js";

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

// ═════════════════════════════════════════════════════════════════════════════
// ★★★ C551 — THE BOOKING WHOSE OWN EXPLANATION ARGUES FOR A DIFFERENT CATEGORY (TIER 1 #7).
//
// The live case (O83): a Lone Star food-supplier bill was auto-booked to Travel &
// Entertainment at 92% while its OWN stored reasoning said the items were "direct product
// costs properly classified as Cost of Goods Sold". The model contradicted itself and the
// books took the half that was wrong, with nobody asked. No confidence threshold can catch
// it — the score was high because the model was sure, and it was sure of the other answer.
//
// ★★ WHAT COUNTS AS A CONTRADICTION IS DELIBERATELY NARROW, because the cost of a false
// positive is a question the owner did not need (`O122`: noise is a defect too). The
// reasoning is free text written to explain "why this account fits", so it mentions other
// things all the time — freight on a produce invoice, cash, a considered alternative. So a
// contradiction is an ASSERTION, not a mention:
//   • another income/expense account of THIS company's chart (by name or code) is the
//     object of a classification phrase — "classified as", "belongs in", "should be",
//     "properly …", "recorded as" — within three words;
//   • that phrase is not negated or hedged ("not", "rather than", "could also be" …) —
//     a considered alternative is the model showing its work, not changing its answer;
//   • and the BOOKED account is never the object of such a phrase — "classified as Food
//     Cost rather than Freight" is the model agreeing with itself.
// Balance-sheet accounts ("paid in cash") and the catch-all buckets ("miscellaneous
// kitchen items") never count: they are ordinary words far more often than they are claims.
//
// ★ AND NAMING THE BROADER PARENT OF A SUB-ACCOUNT IS NOT A CONTRADICTION. A restaurant's
// Food Cost (5010) IS cost of goods sold, and "classified as Cost of Goods Sold" on a Food
// Cost booking is the reasoning being less specific, not disagreeing. The chart has no
// parent column, so the parent is read off the numbering (§4): a round-hundred account in
// the same block. It only runs one way — booked Technology & Software (6500) with reasoning
// that says Merchant Processing Fees (6520) IS flagged, which is the Toast-fee case.
//
// ▶ LIMITS, stated: it recognises the company's own account NAMES and CODES only, so an
// acronym the chart does not spell ("COGS") or a paraphrase ("food costs") passes unseen.
// That is the safe direction — the booking behaves as it did before this check existed.
// ═════════════════════════════════════════════════════════════════════════════
const normText = (s) => ` ${String(s || "").toLowerCase()
  .replace(/\([^)]*\)/g, " ").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ")
  .replace(/\s+/g, " ").trim()} `;
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// The phrases that ASSIGN a category. Bare verbs a supplier's invoice uses for other
// reasons ("charged", "includes") are deliberately absent.
const CUES = "classified|classify|classifies|categori[sz]ed|categori[sz]e|belongs|belong|should be|should go|properly|correctly|appropriately|recorded|treated|coded|booked|expensed|falls under|fits under";
// A cue read after one of these is a considered alternative or a denial, not a claim.
const HEDGES = new Set(["not", "never", "rather", "instead", "than", "could", "might", "may", "alternatively", "also", "or", "if", "unless", "although", "though", "nor"]);

function nameForms(acct) {
  const forms = new Set();
  const full = normText(acct.name).trim();
  if (full) forms.add(full);
  const stem = full.replace(/ expenses?$/, "").trim();
  if (stem && stem !== full && stem.length >= 4) forms.add(stem);
  if (acct.code && /^\d{4}$/.test(String(acct.code))) forms.add(String(acct.code));
  return [...forms];
}

// Is `form` the object of an un-hedged classification cue anywhere in `text`?
function assertedAs(text, form) {
  const re = new RegExp(`(?:^| )((?:\\S+ ){0,3})(?:${CUES}) ((?:\\S+ ){0,3})${escRe(form)} `, "g");
  let m;
  while ((m = re.exec(text))) {
    const before = m[1].trim().split(" ").filter(Boolean);
    const between = m[2].trim().split(" ").filter(Boolean);
    if ([...before, ...between].some((w) => HEDGES.has(w))) continue;
    return true;
  }
  return false;
}

const isParentOf = (parentCode, childCode) => {
  const p = String(parentCode || ""), c = String(childCode || "");
  return /^\d{4}$/.test(p) && /^\d{4}$/.test(c) && p !== c && p.endsWith("00") && p.slice(0, 2) === c.slice(0, 2);
};

export function reasoningContradiction(txn = {}, { chart = [] } = {}) {
  const text = normText(txn.reasoning);
  if (text.trim().length === 0 || !Array.isArray(chart) || chart.length === 0) return null;
  const bookedCode = txn.gl_code != null ? String(txn.gl_code).trim() : "";
  const bookedAcct = chart.find((a) => a && String(a.code) === bookedCode) || null;
  const bookedForms = new Set([
    ...(bookedAcct ? nameForms(bookedAcct) : []),
    ...(txn.gl_name ? nameForms({ name: txn.gl_name, code: bookedCode }) : bookedCode ? [bookedCode] : []),
  ]);
  if ([...bookedForms].some((f) => assertedAs(text, f))) return null;   // it argues for what it booked
  for (const a of chart) {
    if (!a || a.active === false) continue;
    const code = String(a.code || "");
    if (!code || code === bookedCode) continue;
    if (!(glIsRevenue(code) || glIsExpense(code))) continue;          // "paid in cash" is not a claim
    if (isCatchAllAccount({ gl_code: code, gl_name: a.name, system_role: a.system_role })) continue;
    if (isParentOf(code, bookedCode)) continue;                          // Food Cost IS cost of goods sold
    if (nameForms(a).some((f) => !bookedForms.has(f) && assertedAs(text, f))) return { code, name: a.name };
  }
  return null;
}

export function autoBookDecision(txn = {}, { askFloor = AI_CONFIDENCE_ASK_FLOOR, chart = [], ...opts } = {}) {
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
  // ★★ C551 — and so is a confident booking whose own explanation says it belongs elsewhere.
  // Same placement argument: after the floor, before materiality, because a self-contradiction
  // is worth one question at any amount.
  const named = reasoningContradiction(txn, { chart });
  if (named) return { autoBook: false, reason: REASONING_CONTRADICTS, named };
  if (shouldFlagForReview(txn, opts).flagged) return { autoBook: false, reason: "flagged_uncertain_material" };
  return { autoBook: true, reason: "confident" };
}
// The one routing value the question card reads (`clarificationChips`) — exported so the
// writer and the reader cannot spell it two ways.
export const REASONING_CONTRADICTS = "reasoning_names_other_account";

// The queryable "needs review" SET (what O50's CPA surface will consume). Each item carries
// the AI's CHOSEN account, its CONFIDENCE, the WHY (reasoning — ties C107/C109), any
// ALTERNATIVES the model considered, plus the flag reason + severity. Most material / least
// confident first — the order a CPA should work them.
export function flaggedForReview(invoices = [], opts = {}) {
  const out = [];
  // C518 — one judgement per ENTRY, on the entry's total. Flatten expands a multi-line entry
  // into one row per line, and each row was judged on its own share: a $3,000 two-line bill at
  // 62% was flagged twice, an $1,800 bill split 900/900 at 62% not at all (each line under the
  // $1,000 materiality, the bill over it).
  for (const i of collapseExpandedRows(invoices || [])) {
    if (!i || i.status === "voided" || i.status === "deleted") continue;
    const a = shouldFlagForReview({ ...i, amount: listAmount(i) }, opts);
    if (!a.flagged) continue;
    out.push({
      id: i.id,
      db_entry_id: i.db_entry_id ?? null,
      vendor: i.vendor ?? null,
      description: i.description ?? null,
      date: i.date ?? null,
      amount: listAmount(i),
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
