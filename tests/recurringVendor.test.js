import { describe, it, expect } from "vitest";
import { classifyCadence, planSetSettlement, countMismatchCopy, SET_ACTION, FLAT_SD_RATIO } from "../src/lib/recurringVendor.js";
import { planInvoiceArrival, ARRIVAL, ASK_REASON } from "../src/lib/invoicePayment.js";

// ═════════════════════════════════════════════════════════════════════════════
// O117 + O127 — THE FLAT-FEE RECURRING VENDOR.
// Spec: docs/RECURRING_FLAT_FEE_SPEC_O117_O127.md §9 (acceptance criteria).
//
// ★★ THESE ASSERTIONS WERE WRITTEN BEFORE THE IMPLEMENTATION, per O127's own lesson: the
// over-match was caught only because a criterion named a specific vendor and a specific
// DIRECTION OF SURPRISE in advance. A missing card is harder to notice than a wrong one,
// because absence has no pixel.
// ═════════════════════════════════════════════════════════════════════════════

const CASH = "1000";
const pay = (id, date, amount, over = {}) => ({
  id, db_entry_id: id, date, amount, vendor: "Bluebonnet Linen Service",
  description: "Bluebonnet Linen Service – ACH DEBIT - BLUEBONNET LINEN SERVICE",
  gl_code: over.gl_code || "6100", secondary_gl_code: CASH, debit_credit: "debit", source: "bank_import",
  status: "booked", import_metadata: over.import_metadata || null, ...over,
});
const invoice = (date, amount = 145.0, over = {}) => ({
  id: `inv-${date}`, date, amount, vendor: "Bluebonnet Linen Service", ...over,
});
const CTX = { cashCodes: [CASH] };
const attached = { invoice_attached: true, attached_invoice_id: "x" };

// July: four weekly $145 charges. August: four more.
const july = [pay("j1", "2026-07-06", 145), pay("j2", "2026-07-13", 145), pay("j3", "2026-07-20", 145), pay("j4", "2026-07-27", 145)];
const aug  = [pay("a1", "2026-08-03", 145), pay("a2", "2026-08-10", 145), pay("a3", "2026-08-17", 145), pay("a4", "2026-08-24", 145)];

describe("★ recognising the class", () => {
  it("four identical weekly charges over two months IS the class", () => {
    const c = classifyCadence([...july, ...aug].map(p => ({ date: p.date, amount: p.amount })));
    expect(c.flatFee).toBe(true);
    expect(c.perPeriod).toBe(4);
    expect(c.ratio).toBe(0);
  });

  it("★ a MONTHLY vendor is NOT in the class — one charge a period has an unambiguous pair", () => {
    // The blast-radius control: only vendors charging more often than the period change
    // behaviour. This is spec §9/§4 (Franklin Ave rent must behave exactly as today).
    const rent = ["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"].map(d => ({ date: d, amount: 4800 }));
    expect(classifyCadence(rent).flatFee).toBe(false);
  });

  it("★ a vendor whose amount VARIES is not in the class — the amount is informative again", () => {
    const produce = [["2026-07-06", 210], ["2026-07-13", 260], ["2026-08-03", 190], ["2026-08-10", 305]]
      .map(([date, amount]) => ({ date, amount }));
    expect(classifyCadence(produce).flatFee).toBe(false);
  });

  it("two charges are a coincidence, not a cadence", () => {
    expect(classifyCadence([{ date: "2026-07-06", amount: 145 }, { date: "2026-08-06", amount: 145 }]).flatFee).toBe(false);
  });

  it("★ a price RISE does not silently become the vendor's usual amount", () => {
    // ★★ THIS ASSERTION CHANGED WHEN THE STATISTIC DID, AND THE NEW ONE IS STRONGER.
    // It used to read "a price rise takes the vendor OUT of the class", which was testing
    // the MECHANISM (mean/σ moves) rather than the property. Under median/MAD the vendor
    // correctly STAYS in the class — it is still a flat-fee weekly vendor, just at a new
    // rate — and leaving the class would have restored every week of noise at the OLD
    // price too.
    //
    // The property actually worth holding is that the new price is not yet the pattern,
    // so charges at it keep the ordinary treatment until it becomes typical. That is
    // mechanism-independent and is what protects against a change being absorbed silently.
    const risen = [...july.map(p => ({ date: p.date, amount: 145 })), { date: "2026-08-03", amount: 160 }, { date: "2026-08-10", amount: 160 }];
    const c = classifyCadence(risen);
    expect(c.center).toBe(145);                       // the typical charge is still the old one
    expect(Math.abs(160 - c.center) / c.center).toBeGreaterThan(FLAT_SD_RATIO);   // 160 is NOT it
  });

  it("★ and two odd charges do NOT destroy the classification — that restored all the noise", () => {
    // The failure this whole statistic change came from: 8 weekly $145 charges plus two
    // one-off $620s. Under mean/σ the vendor left the class and every $145 week started
    // raising a duplicate card again. A vendor is not un-flat because it once bought
    // something else.
    const withOutliers = [...july, ...aug].map(p => ({ date: p.date, amount: 145 }))
      .concat([{ date: "2026-08-19", amount: 620 }, { date: "2026-08-26", amount: 620 }]);
    const c = classifyCadence(withOutliers);
    expect(c.flatFee).toBe(true);
    expect(c.center).toBe(145);
  });
});

describe("★★★ §1 — THE SILENT FAILURE. The August invoice must not attach to a July payment", () => {
  it("THE LIVE SPECIMEN: BLS-88412 (08-03) does NOT attach to the 07-27 payment", () => {
    // Under the old pair rule this attached: gap = -7, the test is `gap < -7`, so 07-27
    // survived BY ONE DAY while 07-06/13/20 were excluded — one survivor reads as
    // certainty. Attaching it again is a HARD FAIL.
    const plan = planInvoiceArrival(invoice("2026-08-03"), [...july, ...aug], CTX);
    expect(plan.action).toBe(ARRIVAL.ATTACH);
    expect(plan.candidate.entry.date.startsWith("2026-08")).toBe(true);
    expect(plan.candidate.entry.id).not.toBe("j4");
  });

  it("★ it attaches inside its OWN period, and says the pairing was by set", () => {
    const plan = planInvoiceArrival(invoice("2026-08-03"), [...july, ...aug], CTX);
    expect(plan.pairing).toBe("set");
    expect(plan.basis).toBe("flat_fee_period_set");
  });

  it("★★ AND WITH NO AUGUST PAYMENTS AT ALL IT STILL REFUSES JULY — it books a payable", () => {
    // The sharpest form of the bug: strip August, and the old rule would take the 07-27
    // payment again. There must be no path back to a previous period.
    const plan = planInvoiceArrival(invoice("2026-08-03"), july, CTX);
    expect(plan.action).not.toBe(ARRIVAL.ATTACH);
    expect(plan.candidate).toBe(null);
  });
});

describe("★★ §2 — THE NOISE. A normal month produces no cards", () => {
  it("four invoices against four payments: four attaches, zero questions", () => {
    const entries = [...july, ...aug];
    const dates = ["2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24"];
    const claimed = new Set();
    for (const d of dates) {
      const live = entries.map(e => claimed.has(e.id) ? { ...e, import_metadata: attached } : e);
      const plan = planInvoiceArrival(invoice(d), live, CTX);
      expect(plan.action).toBe(ARRIVAL.ATTACH);
      claimed.add(plan.candidate.entry.id);
    }
    expect(claimed.size).toBe(4);   // four DISTINCT charges — no charge claimed twice
  });
});

describe("★★★ §3 — THE ANTI-VACUITY CHECK. Suppression must not become blindness", () => {
  it("FIVE invoices against four payments raises EXACTLY ONE card, naming the counts", () => {
    // ★ IF THIS CARD DOES NOT APPEAR, THE FIX IS WORSE THAN THE BUG — it will have made a
    // genuinely unpaid delivery invisible, which is the single most likely way a wrong
    // implementation looks BETTER than a right one.
    const allClaimed = [...july, ...aug.map(e => ({ ...e, import_metadata: attached }))];
    const plan = planInvoiceArrival(invoice("2026-08-31"), allClaimed, CTX);
    expect(plan.action).toBe(ARRIVAL.BOOK_PAYABLE);
    expect(plan.reason).toBe(ASK_REASON.PERIOD_COUNT_MISMATCH);
    expect(plan.setCounts).toMatchObject({ payments: 4, claimed: 4, invoices: 5 });
  });

  it("★ and the sentence states the two numbers, drawing no conclusion about why", () => {
    const copy = countMismatchCopy({ vendor: "Bluebonnet Linen Service", period: "August", counts: { invoices: 5, payments: 4 } });
    expect(copy).toMatch(/5 Bluebonnet Linen Service invoices for August but only 4 payments/);
    expect(copy).toMatch(/looks unpaid/);
    // The payroll gate's refusals are the reference standard: report what was computed,
    // let the human supply the meaning. No theory of intent.
    expect(copy).not.toMatch(/fraud|error|mistake|should have|appears to be/i);
  });
});

describe("★ §4 — the class boundary holds: everything else is untouched", () => {
  it("a monthly vendor still uses the pair rule", () => {
    const rent = ["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"].map((d, i) =>
      pay(`r${i}`, d, 4800, { vendor: "Franklin Ave Properties", description: "Franklin Ave Properties – ACH DEBIT - FRANKLIN AVE PROPERTIES" }));
    const plan = planInvoiceArrival(
      { id: "rent-inv", date: "2026-08-02", amount: 4800, vendor: "Franklin Ave Properties" }, rent, CTX);
    expect(plan.action).toBe(ARRIVAL.ATTACH);
    expect(plan.basis).toBe("exact_identity_exact_amount");   // the OLD basis — unchanged
    expect(plan.pairing).toBeUndefined();
  });

  it("a one-off vendor with a single payment is untouched", () => {
    const one = [pay("o1", "2026-08-06", 425, { vendor: "Alamo Fire & Safety", description: "Alamo Fire & Safety – ACH DEBIT - ALAMO FIRE AND SAFETY" })];
    const plan = planInvoiceArrival({ id: "af", date: "2026-08-05", amount: 425, vendor: "Alamo Fire & Safety" }, one, CTX);
    expect(plan.action).toBe(ARRIVAL.ATTACH);
    expect(plan.basis).toBe("exact_identity_exact_amount");
  });
});

describe("★ the set planner in isolation", () => {
  const cadence = { flatFee: true };
  it("attaches to the EARLIEST unclaimed charge — deterministic, not whichever came first", () => {
    const r = planSetSettlement({ cadence, periodPayments: [
      { entry: { id: "b", date: "2026-08-17" }, claimed: false },
      { entry: { id: "a", date: "2026-08-03" }, claimed: false },
    ] });
    expect(r.action).toBe(SET_ACTION.ATTACH_UNCLAIMED);
    expect(r.candidate.entry.id).toBe("a");
  });

  it("declines to apply itself outside the class", () => {
    expect(planSetSettlement({ cadence: { flatFee: false }, periodPayments: [] }).action).toBe(SET_ACTION.NOT_APPLICABLE);
    expect(planSetSettlement({}).action).toBe(SET_ACTION.NOT_APPLICABLE);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// §7 — THE DETECTION HALF. Spec §9 criteria §2 and §3, applied to the detector.
//
// `findDuplicate` keys on same-vendor + same-amount inside a FIXED 7-day window, which for
// a weekly flat-fee vendor is true EVERY WEEK by construction. The fix measures the window
// in the VENDOR'S OWN RHYTHM — and the half that matters is that a genuine double-charge
// still survives it.
// ═════════════════════════════════════════════════════════════════════════════
import { runAnomalyDetection } from "../src/lib/insights.js";
import { typicalIntervalDays, isOffRhythm, offRhythmCopy } from "../src/lib/recurringVendor.js";

const exp = (id, date, amount, vendor = "Bluebonnet Linen Service") => ({
  id, date, amount, vendor, gl_code: "6100", gl_name: "Rent & Occupancy",
  status: "booked", type: "expense",
});
const NOW = new Date("2026-08-31T12:00:00Z");
// Eight weekly $145 charges across July and August — the live shape.
const weekly = ["2026-07-06","2026-07-13","2026-07-20","2026-07-27","2026-08-03","2026-08-10","2026-08-17","2026-08-24"]
  .map((d, n) => exp(`w${n}`, d, 145));
const dupCards = (rows) => runAnomalyDetection(rows, [], NOW, { frontier: "2026-08-31" })
  .filter(a => a.type === "duplicate_payment");

describe("★★ §7/§2 — the weekly card is gone", () => {
  it("THE LIVE NOISE: eight weekly identical charges raise ZERO duplicate cards", () => {
    // Four cards for Bluebonnet in August alone, every month, forever. By O122 a card you
    // see every period is a bug wearing a question mark.
    expect(dupCards(weekly)).toHaveLength(0);
  });

  it("★ a vendor we have NOT established still gets the ordinary rule", () => {
    // Two charges, no cadence to speak of — the old behaviour must be untouched.
    const pair = [exp("p1", "2026-08-10", 890, "Sharp Edge Cutlery"), exp("p2", "2026-08-12", 890, "Sharp Edge Cutlery")];
    expect(dupCards(pair)).toHaveLength(1);
  });
});

describe("★★★ §7/§3 — THE ANTI-VACUITY CHECK. A real double-charge must survive", () => {
  it("TWO CHARGES THREE DAYS APART, on a weekly vendor, STILL RAISES A CARD", () => {
    // ★ IF THIS DOES NOT FIRE, THE FIX IS WORSE THAN THE BUG — it will have made a genuine
    // double-charge invisible on the vendor most likely to suffer one, which is the single
    // most likely way a wrong implementation looks BETTER than a right one.
    const cards = dupCards([...weekly, exp("extra", "2026-08-27", 145)]);   // 3 days after 08-24
    expect(cards).toHaveLength(1);
    expect(cards[0].severity).toBe("high");
  });

  it("★ and the card names the RHYTHM, not the fact that two identical charges exist", () => {
    const cards = dupCards([...weekly, exp("extra", "2026-08-27", 145)]);
    expect(cards[0].description).toMatch(/twice in 3 days/);
    expect(cards[0].description).toMatch(/normally charge about every 7 days/);
    // For this vendor "two charges for the same amount" is not news, so it must not be
    // the sentence.
    expect(cards[0].description).not.toMatch(/within a week/);
    // Reports what was computed; supplies no theory of why.
    expect(cards[0].description).not.toMatch(/fraud|error|mistake|should/i);
  });

  it("★ a flat-fee vendor charging an UNUSUAL amount keeps the ordinary rule", () => {
    // ★★ THIS TEST WAS VACUOUS ON ITS FIRST WRITING AND THE MUTATION RUN CAUGHT IT.
    // It used a 2-day gap, so removing the usual-amount scope still produced a card —
    // just a different one — and the assertion `length >= 1` could not tell them apart.
    // A SEVEN-day gap discriminates: it is ON the vendor's rhythm, so without the amount
    // scope it would be SUPPRESSED, while with it the pair falls through to the ordinary
    // fixed-window rule and fires. Two charges of an unfamiliar amount a week apart is
    // exactly what the ordinary rule is for.
    const cards = dupCards([...weekly, exp("odd1", "2026-08-19", 620), exp("odd2", "2026-08-26", 620)]);
    expect(cards).toHaveLength(1);
    expect(cards[0].description).toMatch(/within a week/);          // the ORDINARY card…
    expect(cards[0].description).not.toMatch(/normally charge/);    // …not the rhythm one
  });
});

describe("★ the rhythm primitives", () => {
  it("takes the MEDIAN gap, so one long break doesn't stretch the rhythm", () => {
    // Mean would be ~13 and start suppressing real double-charges; median stays 7.
    expect(typicalIntervalDays(["2026-07-06","2026-07-13","2026-07-20","2026-09-01"])).toBe(7);
  });
  it("no interval means NO OPINION — which must not read as 'fine'", () => {
    expect(isOffRhythm(3, null)).toBe(null);
    expect(typicalIntervalDays(["2026-07-06"])).toBe(null);
  });
  it("splits at half the vendor's own spacing", () => {
    expect(isOffRhythm(3, 7)).toBe(true);
    expect(isOffRhythm(7, 7)).toBe(false);
    expect(isOffRhythm(4, 7)).toBe(false);
  });
  it("same-day reads as same-day, not 'twice in 0 days'", () => {
    expect(offRhythmCopy({ vendor: "X", gapDays: 0, intervalDays: 7 })).toMatch(/twice on the same day/);
  });
});
