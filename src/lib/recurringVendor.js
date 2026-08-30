// ─────────────────────────────────────────────────────────────────────────────
// O117 + O127 — THE FLAT-FEE RECURRING VENDOR.
// Spec: docs/RECURRING_FLAT_FEE_SPEC_O117_O127.md
//
// ★★ THE PROPERTY: for a vendor billing the same amount on a regular cadence, AMOUNT AND
// IDENTITY CARRY NO INFORMATION. Bluebonnet Linen bills $145.00 every week — every axis
// the matcher normally reasons from is constant across every document, so **any decision it
// reaches is being made by whatever variable is left over**, which was a date window chosen
// for something else.
//
// Live: an invoice dated 08-03 attached to a payment dated 07-27 because `gap = -7` and the
// test is `gap < -7` — it survived BY ONE DAY while the other three identical payments were
// excluded. One survivor reads as certainty. **The certainty was manufactured by the window,
// not found in the evidence**, and it failed silently: August lost a delivery.
//
// ★★★ THE REFRAME, AND IT IS THE WHOLE MODULE: THE PAIR IS THE WRONG UNIT.
// Ask what actually goes wrong if invoice A attaches to payment 3 rather than payment 1,
// given all four are identical.
//   · WITHIN a period — nothing. Every account, every total, every control figure is the
//     same. The pairing is UNOBSERVABLE IN THE BOOKS.
//   · ACROSS a period boundary — the expense moves months. That is the entire damage.
// So "which payment does this invoice belong to" is unanswerable from the data AND mostly
// not worth answering. "Does this vendor's period balance" is the question — which is also
// what a bookkeeper does: handed four identical invoices and four identical payments,
// nobody agonises over the pairing; they check that four is four, and what they catch is
// five-against-four.
//
// ▶ AND THE THRESHOLD IS NOT TUNED. Widening it produces more ambiguity, narrowing it
// produces phantom payables, and NEITHER ADDS A BIT OF INFORMATION. The window stops being
// consulted for this class rather than being adjusted for it.
// ─────────────────────────────────────────────────────────────────────────────

// A vendor is FLAT when its charges vary by less than this fraction of their mean. Not a
// tuning knob for the matching decision — it only decides CLASS MEMBERSHIP, and the two
// sides of the boundary get behaviour that is correct for them either way.
export const FLAT_SD_RATIO = 0.02;

// Two data points are a coincidence, not a cadence. FOUR is the bar, and it is carried by
// the observation count alone.
export const MIN_OBSERVATIONS = 4;

// ★★ ONE PERIOD IS ENOUGH, AND THE TEST IS WHAT ESTABLISHED THAT. This was 2, on the
// reasoning that a cadence needs to repeat across months. A pre-registered criterion —
// "an August invoice must not reach a July payment even when August has no payments at
// all" — failed against it: with only July in the ledger the class went UNRECOGNISED, so
// the invoice fell through to the pair rule and took the 07-27 payment. **The recognition
// bar was re-opening the exact bug it sits in front of.**
//
// ★ THE DECIDING ARGUMENT IS THAT THE TWO ERRORS ARE NOT SYMMETRIC:
//   · Recognising the class TOO EAGERLY → we decline a cross-period attach and book a
//     payable instead. Visible, on the CPA's list, trivially corrected.
//   · Recognising it TOO LATE → the silent cross-period attach. A delivery vanishes from a
//     month and nothing on any screen says so.
// So the bar belongs on the side that fails loudly. Four identical charges is already a
// strong signal; requiring them to straddle a month boundary bought nothing and cost the
// boundary case, which is precisely where the bug lives.
export const MIN_PERIODS = 1;

export const periodOf = (d) => String(d || "").slice(0, 7);

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ── RECOGNITION ──────────────────────────────────────────────────────────────
// `observations` are this vendor's charges: [{ date, amount }]. Deliberately takes plain
// values rather than ledger rows, so identity resolution stays with the resolver and this
// module cannot grow a second opinion about who a vendor is (O125's lesson).
//
// ★ EVERY INPUT IS DERIVABLE FROM BOOKED ENTRIES. This must NOT read `vendor_state`: that
// table is live but EMPTY — Amendment B withholds every backfill tier and C201 is on hold —
// so depending on it would park this behind O102, the largest item on the board.
export function classifyCadence(observations = []) {
  const obs = (observations || [])
    .filter((o) => o && o.date && Number.isFinite(Number(o.amount)) && Number(o.amount) !== 0)
    .map((o) => ({ period: periodOf(o.date), amount: Math.abs(Number(o.amount)) }));

  const n = obs.length;
  const periods = new Set(obs.map((o) => o.period));
  const empty = { flatFee: false, n, periods: periods.size, perPeriod: 0, mean: 0, sd: 0, ratio: null };
  if (n < MIN_OBSERVATIONS || periods.size < MIN_PERIODS) return empty;

  const mean = obs.reduce((s, o) => s + o.amount, 0) / n;
  if (!(mean > 0)) return empty;
  const variance = obs.reduce((s, o) => s + (o.amount - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(variance);
  const ratio = sd / mean;
  const perPeriod = n / periods.size;

  return {
    // FLAT — the amount carries no information.
    // FREQUENT — more than one charge per period. A vendor billing ONCE a period has an
    // unambiguous pairing already, so it keeps today's behaviour untouched. This is the
    // blast-radius control: the class definition and the rule change are one decision.
    flatFee: ratio <= FLAT_SD_RATIO && perPeriod > 1,
    n, periods: periods.size, perPeriod: Math.round(perPeriod * 100) / 100,
    mean: r2(mean), sd: r2(sd), ratio: Math.round(ratio * 10000) / 10000,
  };
}

// ── THE DECISION ─────────────────────────────────────────────────────────────
export const SET_ACTION = {
  ATTACH_UNCLAIMED: "attach_unclaimed",   // a charge in this period has no invoice yet
  PAYABLE_AND_ASK: "payable_and_ask",     // more invoices than charges — one looks unpaid
  PAYABLE_NO_CARD: "payable_no_card",     // no charge yet this period — an ordinary unpaid bill
  NOT_APPLICABLE: "not_applicable",       // not this class; the pair rule stands
};

// `periodPayments` — this vendor's cash-settled charges in the INVOICE'S OWN period, each
// `{ entry, claimed }`. The period is the ACCOUNTING MONTH: the unit the books are already
// organised in and the unit sign-off attests. **Deliberately not a tunable knob** — the one
// number in the old design that could be argued about is replaced by a boundary the product
// already has a meaning for.
export function planSetSettlement({ cadence = null, periodPayments = [] } = {}) {
  if (!cadence || !cadence.flatFee) {
    return { action: SET_ACTION.NOT_APPLICABLE, candidate: null, counts: null };
  }
  const payments = periodPayments.length;
  const claimed = periodPayments.filter((p) => p && p.claimed).length;
  const unclaimed = periodPayments.filter((p) => p && !p.claimed);
  // `invoices` = the ones already attached in this period, plus the one arriving now. So
  // "more invoices than charges" is exactly "nothing left unclaimed", computed from what
  // the ledger actually holds rather than from a second population we would have to track.
  const counts = { payments, claimed, invoices: claimed + 1 };

  if (!payments) {
    // No charge from this vendor in this period at all. An ordinary unpaid bill — book the
    // payable and say nothing, because there is nothing surprising to say.
    return { action: SET_ACTION.PAYABLE_NO_CARD, candidate: null, counts };
  }
  if (!unclaimed.length) {
    // Every charge this period is already spoken for, so this delivery has none behind it.
    // Book the payable (visible, normal) and raise ONE card for the period.
    return { action: SET_ACTION.PAYABLE_AND_ASK, candidate: null, counts };
  }
  // Attach to the EARLIEST unclaimed charge — deterministic so the same inputs always give
  // the same result, and arbitrary-and-known-to-be rather than arbitrary-and-presented-as-
  // certain. The link records `pairing: "set"` so nothing downstream believes a precision
  // that was never established.
  const sorted = [...unclaimed].sort((a, b) =>
    String(a.entry?.date || "").localeCompare(String(b.entry?.date || "")));
  return { action: SET_ACTION.ATTACH_UNCLAIMED, candidate: sorted[0], counts };
}

// The card, when the counts disagree. States the two numbers and draws no conclusion about
// why — the reference standard set by the payroll gate's refusals (O115 doctrine).
export function countMismatchCopy({ vendor, period, counts } = {}) {
  const who = vendor || "This supplier";
  const label = period || "this month";
  return `We have ${counts.invoices} ${who} invoice${counts.invoices === 1 ? "" : "s"} for ${label} but only ${counts.payments} payment${counts.payments === 1 ? "" : "s"} — one of them looks unpaid.`;
}
