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
  const empty = { flatFee: false, n, periods: periods.size, perPeriod: 0, center: 0, mean: 0, sd: 0, ratio: null };
  if (n < MIN_OBSERVATIONS || periods.size < MIN_PERIODS) return empty;

  const mean = obs.reduce((s, o) => s + o.amount, 0) / n;
  if (!(mean > 0)) return empty;

  // ★★ MEDIAN AND MEDIAN-ABSOLUTE-DEVIATION, NOT MEAN AND σ — AND A TEST ESTABLISHED THIS.
  // With mean/σ, a weekly $145 vendor that also had TWO one-off $620 charges failed the
  // flatness test, left the class entirely, and **every week of $145 noise came back**. A
  // vendor is not un-flat because it once bought something else.
  //
  // ★ MEAN AND σ ARE THE WRONG STATISTICS FOR THIS QUESTION BY CONSTRUCTION: outliers are
  // precisely what we are trying to EXCLUDE, and those two are precisely the statistics
  // outliers move most. The median is unmoved by a couple of odd charges, so the class
  // survives them and `atUsualAmount` then correctly treats the odd charges as not-the-
  // pattern. Same reasoning as `typicalIntervalDays` using a median gap — one long break
  // must not stretch the rhythm.
  const sorted = obs.map((o) => o.amount).sort((a, b) => a - b);
  const median = (xs) => {
    const mid = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  };
  const center = median(sorted);
  if (!(center > 0)) return empty;
  const mad = median(sorted.map((x) => Math.abs(x - center)).sort((a, b) => a - b));
  const variance = obs.reduce((s, o) => s + (o.amount - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(variance);
  const ratio = mad / center;
  const perPeriod = n / periods.size;

  return {
    // FLAT — the amount carries no information.
    // FREQUENT — more than one charge per period. A vendor billing ONCE a period has an
    // unambiguous pairing already, so it keeps today's behaviour untouched. This is the
    // blast-radius control: the class definition and the rule change are one decision.
    flatFee: ratio <= FLAT_SD_RATIO && perPeriod > 1,
    n, periods: periods.size, perPeriod: Math.round(perPeriod * 100) / 100,
    // `center` is the value DECISIONS use (the typical charge). `mean`/`sd` are reported
    // for the record and are deliberately NOT what the class test reads.
    center: r2(center), mean: r2(mean), sd: r2(sd), ratio: Math.round(ratio * 10000) / 10000,
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

// ─────────────────────────────────────────────────────────────────────────────
// O117 — THE DETECTION HALF. Spec §7.
//
// `findDuplicate` keys on same-vendor + same-amount inside a FIXED 7-day window. For a
// vendor that bills weekly at a flat rate that is true EVERY WEEK, BY CONSTRUCTION — four
// Bluebonnet cards in August alone. By `O122`, **a card you see every period is a bug
// wearing a question mark**, so the fixed window makes the detector useless for exactly the
// vendors it fires on most.
//
// ★★ BUT SUPPRESSION MUST NOT BECOME BLINDNESS, AND THAT IS THE LOAD-BEARING HALF. A
// genuine double-charge to Bluebonnet has to survive. So the window is not removed and not
// widened — **it is measured in the vendor's OWN RHYTHM instead of in days.** Two charges
// seven days apart is Bluebonnet's rhythm; two charges three days apart is not, whatever
// the calendar says.
//
// ★ THAT IS ADDING INFORMATION, NOT TUNING A THRESHOLD. The constraint against tuning
// (spec §2) is about a window standing in for evidence we do not have. Here the vendor's
// observed cadence IS evidence, and we were simply not using it.
//
// ★★ AND IT IS WHY THIS DOES NOT COUNT PER MONTH, WHICH IS WHAT THE SPEC ORIGINALLY SAID
// (§7: "charged 6 times in August; they normally charge 4"). A weekly vendor legitimately
// charges FIVE times in a month with five Mondays. A monthly count would fire on the
// calendar rather than on the vendor — a category-1 card, which is precisely what this is
// meant to remove. The rhythm framing says the same thing and cannot be fooled by month
// length. Recorded as a deliberate deviation from the signed shape, not an oversight.
// ─────────────────────────────────────────────────────────────────────────────

// A gap shorter than this fraction of the vendor's own typical interval is off-rhythm.
// Half is the natural split: it is the point at which a charge is closer to its neighbour
// than to the vendor's normal spacing, so no calendar unit is being smuggled in.
export const OFF_RHYTHM_FRACTION = 0.5;

// The vendor's typical spacing, in days. MEDIAN of consecutive gaps, not mean — one long
// holiday gap must not stretch the rhythm and start suppressing real double-charges.
export function typicalIntervalDays(dates = []) {
  const ds = [...new Set((dates || []).filter(Boolean).map((d) => String(d).slice(0, 10)))].sort();
  if (ds.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < ds.length; i++) {
    const g = (Date.parse(ds[i]) - Date.parse(ds[i - 1])) / 86400000;
    if (Number.isFinite(g) && g > 0) gaps.push(g);
  }
  if (!gaps.length) return null;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

// Is this pair closer together than the vendor's own rhythm allows?
// No interval ⇒ NO OPINION, which must not read as "fine": the caller keeps the ordinary
// fixed-window rule when this returns null.
export function isOffRhythm(gapDays, intervalDays) {
  const g = Math.abs(Number(gapDays));
  const t = Number(intervalDays);
  if (!Number.isFinite(g) || !Number.isFinite(t) || t <= 0) return null;
  return g < t * OFF_RHYTHM_FRACTION;
}

// States the vendor's rhythm and this pair's spacing, and draws no conclusion about why —
// the payroll gate's refusals are the reference standard (O115 doctrine).
export function offRhythmCopy({ vendor, gapDays, intervalDays, amount } = {}) {
  const who = vendor || "This supplier";
  const g = Math.round(Math.abs(Number(gapDays) || 0));
  const t = Math.round(Number(intervalDays) || 0);
  const amt = amount == null ? "" : ` for $${Math.abs(Number(amount) || 0).toFixed(2)}`;
  const when = g === 0 ? "twice on the same day" : `twice in ${g} day${g === 1 ? "" : "s"}`;
  return `${who} charged ${when}${amt} — they normally charge about every ${t} days.`;
}


// ── IS THIS PAIR JUST THE VENDOR DOING WHAT THEY DO? ─────────────────────────
// ONE definition, because there are already THREE places asking "is this a duplicate" and
// only two of them had learned this rule. The anomaly detector (C220) and the invoice
// matcher (C218) both suppress a recurring vendor's ordinary rhythm; the card raised
// DURING UPLOAD never consulted history at all — `findDuplicate` reads vendor, amount and
// a date window and nothing else. Live: Corner Market's Aug 8 ($65.12) and Aug 15 ($65.34)
// grocery runs were offered as a possible duplicate, and would be every week forever.
//
// ★★ SUPPRESSION IS MEASURED IN THE VENDOR'S OWN RHYTHM, NOT IN DAYS. Seven days apart is
// Bluebonnet's cadence; three days apart is not. That adds information we already hold
// rather than tuning a threshold — and a GENUINE double-charge still surfaces.
//
// ▶ AND IT NEEDS `MIN_OBSERVATIONS` CHARGES TO SAY ANYTHING, which is exactly why this is
// not the whole fix. On a cold-start bulk drop the pattern does not exist yet when the
// second document is read, so the first few questions still fire. That half is answered by
// deferring the question until the batch has landed — see `deferDuplicateAsk`.
// ★ THE CALLER SUPPLIES THE VENDOR'S ROWS rather than this module deciding who the vendor
// IS. There are already three implementations of vendor identity in this codebase (O125);
// importing a fourth normalizer here would make the answer depend on a copy that has since
// drifted from the one actually in use. The caller knows which rows are this vendor's.
export function duplicateIsExpectedRhythm(invoice, dup, vendorRows = []) {
  if (!invoice || !dup) return false;
  const rows = (vendorRows || []).filter((r) => r && r.date);
  const cadence = classifyCadence(rows.map((r) => ({ date: r.date, amount: r.amount })));
  if (!cadence.flatFee) return false;

  // A recurring vendor billing something UNUSUAL keeps the ordinary rule — the pattern
  // vouches for the pattern, never for whatever else the vendor happens to send.
  const center = cadence.center;
  if (!(center > 0)) return false;
  const atUsual = (inv) =>
    Math.abs(Math.abs(Number(inv.amount) || 0) - center) / center <= FLAT_SD_RATIO;
  if (!atUsual(invoice) || !atUsual(dup)) return false;

  const gap = Math.abs((new Date(invoice.date) - new Date(dup.date)) / 86400000);
  // `false` means ON rhythm — this is what the vendor does. `true` (off rhythm) and `null`
  // (no usable interval) both keep the question, which is the safe direction.
  return isOffRhythm(gap, typicalIntervalDays(rows.map((r) => r.date))) === false;
}

// ── AND THE HALF THAT ACTUALLY FIXES A COLD START ────────────────────────────
// ★★★ THE SYSTEM ALREADY GETS THIS RIGHT — TEN MINUTES LATE. `runAnomalyDetection` runs
// over the WHOLE ledger after a batch lands, and on the live 35-document drive it raised
// ZERO duplicate anomalies for the three vendors whose upload cards had asked. So the
// question was put to a person BEFORE the evidence that answers it had finished arriving,
// and then answered correctly by the machine, unattended.
//
// ★★ THE RULE THIS RESTS ON IS ALREADY WRITTEN DOWN (`O120`): a question whose wrong
// answer books SILENTLY wrong may interrupt; one whose wrong answer is visible and
// undoable waits its turn. A missed double-charge is two identical rows sitting in the
// ledger — visible, and removable — and the detector re-raises it within the same session
// if it is real. So during a bulk drop the ask is deferred rather than blocking the book.
//
// ▶ A SINGLE document dropped on its own is NOT a batch: nothing further is coming, the
// detector has all the evidence it will ever get, and asking immediately is right.
export function deferDuplicateAsk({ batchSize = 1, sameVendorSoFar = 0 } = {}) {
  if (batchSize <= 1) return false;                     // one file: no more evidence coming
  return sameVendorSoFar < MIN_OBSERVATIONS;            // the pattern cannot be seen yet
}
