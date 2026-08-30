// ─────────────────────────────────────────────────────────────────────────────
// THE TWO RAILS DISAGREE ABOUT WHEN TWO NAMES ARE THE SAME COMPANY — MEASURE IT FIRST.
//
// The bank rail (`autoMatchBankLines`) accepts a party name when either normalised name
// CONTAINS the other. The invoice rail (`invoicePayment.js`) requires exact entity-key
// equality. The roadmap's instruction is explicit and it is the right one: *tighten toward
// exact, never loosen toward substring — and not as a rider on a bug fix, because that path
// has been live and correct for eight drives and changing it needs its own evidence.*
//
// ★★ SO THIS CHANGES NO BEHAVIOUR. It gives the decision the evidence it asked for, in the
// two forms the decision needs:
//   · `nameMatchKind` — the same predicate the matcher already used, now REPORTING which
//     kind of agreement it found, so a live drive records how many matches actually
//     depended on substring rather than merely being permitted by it. **Nobody knows that
//     number today**, and "is the loose rule doing any work?" is the first question.
//   · `substringOnlyPairs` — the standing census: which vendors in a real book WOULD merge
//     under the loose rule and would not under the strict one. That is the blast radius.
//
// ★★★ AND THE RISK IS NARROWER THAN THE RULE LOOKS, WHICH IS ITSELF EVIDENCE. The matcher
// applies the name test only to candidates that ALREADY matched the amount to the cent and
// are on the same side. So a wrong merge needs three coincidences at once: two vendors whose
// names contain one another, an open item of the wrong one at the exact same amount, and the
// same A/R-or-A/P side. **That is not "the loose rule is fine" — it is a precise statement of
// where it bites, and it points at one population: FLAT-FEE RECURRING VENDORS**, whose
// amounts are constant and identical by construction (`O117`/`O127`). If the loose rule ever
// merges anything wrongly, it will be there.
//
// Pure.
// ─────────────────────────────────────────────────────────────────────────────

export const NAME_MATCH = {
  NONE: "none",
  EXACT: "exact",           // the two normalised names are equal
  SUBSTRING: "substring",   // one contains the other — the bank rail's extra reach
};

// ★ EXACTLY THE PREDICATE THE MATCHER ALREADY APPLIED, split so the kind is reportable.
// `kind !== NONE` is true in precisely the cases the old inline expression was true, so
// wiring this in is a refactor and not a change. A test pins that equivalence.
export function nameMatchKind(a, b) {
  const x = String(a == null ? "" : a);
  const y = String(b == null ? "" : b);
  if (!x || !y) return NAME_MATCH.NONE;
  if (x === y) return NAME_MATCH.EXACT;
  if (x.includes(y) || y.includes(x)) return NAME_MATCH.SUBSTRING;
  return NAME_MATCH.NONE;
}

// The census: every pair of DISTINCT names the loose rule would treat as one company and
// the strict rule would not. This is the population at risk, and it is the number the
// tighten-or-not decision needs from a real book.
//
// `normalize` is injected rather than imported so this stays free of the bank rail's own
// name rules — the caller passes whichever normaliser it is actually asking about, and the
// answer is about that normaliser rather than about a copy of it that has since drifted.
export function substringOnlyPairs(names = [], normalize = (s) => String(s == null ? "" : s)) {
  const seen = new Map();                     // normalised → the first raw name that produced it
  for (const raw of names || []) {
    const n = normalize(raw);
    if (!n || n.length < 2) continue;         // the matcher's own floor
    if (!seen.has(n)) seen.set(n, raw);
  }
  const entries = [...seen.entries()];
  const out = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [na, rawA] = entries[i];
      const [nb, rawB] = entries[j];
      if (nameMatchKind(na, nb) === NAME_MATCH.SUBSTRING) {
        out.push({ a: rawA, b: rawB, normalizedA: na, normalizedB: nb });
      }
    }
  }
  return out;
}

// How much of the loose rule's reach was actually used. `matches` are the records
// `autoMatchBankLines` returns, each carrying `name_match`.
//
// ★ THE POINT OF COUNTING IT: if a full drive returns `substring: 0`, tightening the bank
// rail to exact costs nothing observable and the decision is easy. If it returns a real
// number, each one is a case to look at by hand before tightening — which is exactly the
// evidence the roadmap said this change needs and nobody had.
export function nameMatchCensus(matches = []) {
  const out = { exact: 0, substring: 0, unrecorded: 0 };
  for (const m of matches || []) {
    if (!m) continue;
    if (m.name_match === NAME_MATCH.EXACT) out.exact++;
    else if (m.name_match === NAME_MATCH.SUBSTRING) out.substring++;
    else out.unrecorded++;
  }
  return out;
}
