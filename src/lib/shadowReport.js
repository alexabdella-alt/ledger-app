// ─────────────────────────────────────────────────────────────────────────────
// THE SHADOW REPORT — does the ladder get to start booking?
//
// `O102` rebuilds how an account is chosen. The signed spec's sequencing decision is that the
// ladder computes its verdict ALONGSIDE confidence, recording what it WOULD have booked, for
// at least one full drive before it books anything — because *"C198·3a shipped a gate that
// could never fire and a green suite could not tell."*
//
// The runner (`shadowIo.runShadowPass`) has existed and been invoked by nothing. **A run
// nobody scores is the same as no run**, so this is the missing half: it turns a completed
// pass into Amendment A §5's PROCEED / STOP / AMBIGUOUS, with the numbers that decide it.
//
// ★★★ AND IT REFUSES TO SAY PROCEED ON THE MACHINE'S OWN AUTHORITY. Two of the criteria are
// CPA judgements — §4.2's itemised DISAGREE review, and clearing any merge candidate — and a
// report that quietly scored those as passed would be exactly the vacuous pass this whole
// programme exists to prevent. Unresolved human items produce `STOP`, and the report says
// which ones and how many.
//
// ★★ COPY DOCTRINE (§6): every sentence is a claim about what was MEASURED.
//   ✓ "the ladder proposed the attested account on 34 of 41 scored lines"
//   ✗ "97% accurate"
//
// Pure. Reads completed runs; runs nothing, writes nothing, books nothing.
// ─────────────────────────────────────────────────────────────────────────────

import { normalizeName } from "./docDirection.js";

export const SHADOW_VERDICT = {
  PROCEED: "proceed",
  STOP: "stop",
  AMBIGUOUS: "ambiguous",   // not enough evidence either way — run another month
};

// §5: "fewer than 20 scored lines… This clause exists so a thin month cannot be read as a pass."
export const MIN_SCORED_LINES = 20;
// §5: "at least two attested months, one of which is August".
export const MIN_ATTESTED_MONTHS = 2;
export const REQUIRED_MONTH = "08";

const distinct = (xs) => [...new Set(xs)];

// ── §4.1(3) — a verdict that varies across runs on identical input ───────────
// KNOWN is a persistent STATE, not a recomputation: a flapping verdict means the state
// machine is not a state machine.
export function runToRunVariance(runs = []) {
  const byLine = new Map();
  for (const run of runs || []) {
    for (const r of run?.rows || []) {
      if (!r || r.journal_entry_line_id == null) continue;
      const k = String(r.journal_entry_line_id);
      if (!byLine.has(k)) byLine.set(k, new Set());
      byLine.get(k).add(`${r.verdict || "-"}|${r.proposed_account_id || "-"}`);
    }
  }
  const out = [];
  for (const [line, seen] of byLine) if (seen.size > 1) out.push({ line, sawVerdicts: [...seen] });
  return out;
}

// ── §4.1(2) — two attested vendors under ONE entity key ──────────────────────
// ★ THIS FLAGS, IT DOES NOT ADJUDICATE. A key covering two descriptor forms is usually the
// resolver working (a bank string and an invoice string for one supplier); it is a MERGE only
// when they are genuinely different businesses, which a person decides. Reporting them as
// candidates and requiring a human to clear them is the honest shape — claiming to detect a
// merge automatically would be inventing certainty about the one failure that is invisible.
export function mergeCandidates(runs = []) {
  const byKey = new Map();
  for (const run of runs || []) {
    for (const r of run?.rows || []) {
      if (!r?.entity_key || !r.descriptor_display) continue;
      const k = String(r.entity_key);
      if (!byKey.has(k)) byKey.set(k, new Set());
      byKey.get(k).add(normalizeName(r.descriptor_display));
    }
  }
  const out = [];
  for (const [key, forms] of byKey) {
    if (forms.size > 1) out.push({ entityKey: key, descriptors: [...forms].sort() });
  }
  return out;
}

// ── §5 — every STRANGER-classified line proposes Uncategorized and nothing else ──
// A STRANGER resolving to a real account is a PHANTOM (§4.1(1)) — one occurrence stops the
// switch. Checked here directly rather than trusting the counter, because the counter and the
// rows agreeing with each other proves nothing if both come from the same mistake.
export function strangerViolations(runs = []) {
  const out = [];
  for (const run of runs || []) {
    for (const r of run?.rows || []) {
      if (!r || r.tier !== "stranger" || r.excluded_reason) continue;
      if (r.proposed_account_id != null) {
        out.push({ line: r.journal_entry_line_id, descriptor: r.descriptor_display, proposed: r.proposed_account_id });
      }
    }
  }
  return out;
}

// ── §5 — "the shadow record cannot be produced for every in-scope line" ──────
// An unmeasured line is not a passing line: a row carrying neither a verdict nor an exclusion
// reason is a hole in the denominator, and a wrong denominator is how a weak result reads as
// a strong one.
export function coverageGaps(runs = []) {
  const out = [];
  for (const run of runs || []) {
    for (const r of run?.rows || []) {
      if (!r) continue;
      if (!r.verdict && !r.excluded_reason) out.push({ line: r.journal_entry_line_id, descriptor: r.descriptor_display });
    }
  }
  return out;
}

/**
 * The verdict.
 *
 * `runs`            — completed passes (each the object `planShadowRun` returns).
 * `attestedMonths`  — the months a human has signed off, "YYYY-MM".
 * `resolvedDisagreements` / `clearedMergeCandidates` — the CPA's §4.2 work, passed IN.
 *   ★ Absent means UNRESOLVED, never "fine". A report that defaulted these to done would be
 *     the machine granting itself a human's sign-off.
 */
export function shadowReport({
  runs = [], attestedMonths = [], resolvedDisagreements = [], clearedMergeCandidates = [],
} = {}) {
  const list = (runs || []).filter(Boolean);
  const scored = list.reduce((s, r) => s + (r.scored || 0), 0);
  const counts = { agree: 0, park: 0, disagree: 0, phantom: 0 };
  const parkBasis = {};
  for (const r of list) {
    for (const k of Object.keys(counts)) counts[k] += r.counts?.[k] || 0;
    for (const [k, v] of Object.entries(r.parkBasis || {})) parkBasis[k] = (parkBasis[k] || 0) + v;
  }

  const monthsCovered = distinct(list.flatMap((r) => (r.rows || []).map((x) => x?.period).filter(Boolean)));
  const attested = new Set((attestedMonths || []).map(String));
  const attestedCovered = monthsCovered.filter((m) => attested.has(m)).sort();

  const variance = runToRunVariance(list);
  const merges = mergeCandidates(list).filter(
    (m) => !(clearedMergeCandidates || []).map(String).includes(String(m.entityKey)),
  );
  const phantoms = strangerViolations(list);
  const gaps = coverageGaps(list);

  // §4.2 — every DISAGREE itemised and individually resolved. Unresolved ones are the
  // outstanding human work, and they are counted, not assumed away.
  const resolved = new Set((resolvedDisagreements || []).map(String));
  const disagreeLines = list.flatMap((r) => (r.rows || [])
    .filter((x) => x?.verdict === "disagree")
    .map((x) => ({ line: String(x.journal_entry_line_id), descriptor: x.descriptor_display, entityKey: x.entity_key })));
  const unresolvedDisagreements = disagreeLines.filter((d) => !resolved.has(d.line));

  const blockers = [];
  if (counts.phantom > 0 || phantoms.length) {
    blockers.push(`${Math.max(counts.phantom, phantoms.length)} line(s) where a vendor we have never seen was given a real account. Rule 2 says those park in Uncategorized.`);
  }
  if (merges.length) blockers.push(`${merges.length} supplier key(s) covering more than one name — each needs a person to confirm they are the same business.`);
  if (variance.length) blockers.push(`${variance.length} line(s) got a different answer on a re-run of the same data.`);
  if (gaps.length) blockers.push(`${gaps.length} line(s) produced no result at all, so the totals below do not describe the whole month.`);
  if (unresolvedDisagreements.length) blockers.push(`${unresolvedDisagreements.length} disagreement(s) with the signed books still need reviewing one by one.`);
  if (attestedCovered.length < MIN_ATTESTED_MONTHS) blockers.push(`Only ${attestedCovered.length} signed-off month(s) covered; ${MIN_ATTESTED_MONTHS} are needed.`);
  if (!attestedCovered.some((m) => m.endsWith(`-${REQUIRED_MONTH}`))) blockers.push("August is not among the months covered.");

  // ★ THIN EVIDENCE IS NEITHER A PASS NOR A FAIL. Checked AFTER the hard fails, so a month
  // with a phantom in it still reports STOP rather than hiding behind "not enough data".
  let verdict;
  if (blockers.length) verdict = SHADOW_VERDICT.STOP;
  else if (scored < MIN_SCORED_LINES) verdict = SHADOW_VERDICT.AMBIGUOUS;
  else verdict = SHADOW_VERDICT.PROCEED;

  return {
    verdict, scored, counts, parkBasis, blockers,
    monthsCovered: monthsCovered.sort(), attestedCovered,
    variance, mergeCandidates: merges, phantoms, coverageGaps: gaps, unresolvedDisagreements,
    runs: list.length,
  };
}

// The report a person reads. Every line names a measurement (§6).
export function shadowReportCopy(report) {
  if (!report) return null;
  const { verdict, scored, counts, parkBasis, blockers, attestedCovered } = report;
  const lines = [];

  if (!scored) {
    lines.push("No lines were scored, so there is nothing to judge yet.");
  } else {
    lines.push(`The ladder proposed the account already on the books for ${counts.agree} of ${scored} scored lines.`);
    if (counts.park) {
      const why = Object.entries(parkBasis)
        .map(([k, n]) => `${n} ${({
          stranger: "from suppliers we had never seen",
          no_attested_mapping: "where no account had been attested for that supplier",
          directory_role_absent_from_chart: "where the shared list named an account this company does not have",
          no_directory_mapping: "where the shared list had no entry",
        })[k] || k}`)
        .join("; ");
      lines.push(`${counts.park} of ${scored} parked in Uncategorized — ${why}.`);
    }
    if (counts.disagree) lines.push(`${counts.disagree} of ${scored} proposed a different account from the one on the signed books. Each needs reviewing on its own.`);
  }
  lines.push(`Months covered that have been signed off: ${attestedCovered.length ? attestedCovered.join(", ") : "none"}.`);

  if (verdict === SHADOW_VERDICT.PROCEED) {
    lines.push("Every check the system can make on its own has passed, and the reviews are complete.");
  } else if (verdict === SHADOW_VERDICT.AMBIGUOUS) {
    lines.push(`Too few lines to judge either way — ${scored} scored, ${MIN_SCORED_LINES} needed. Run another month.`);
  } else {
    lines.push("Not ready. Outstanding:");
    for (const b of blockers) lines.push(`· ${b}`);
  }
  return lines.join("\n");
}
