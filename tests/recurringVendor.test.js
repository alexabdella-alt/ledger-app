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

  it("a price rise takes the vendor OUT of the class on its own", () => {
    const risen = [...july.map(p => ({ date: p.date, amount: 145 })), { date: "2026-08-03", amount: 160 }, { date: "2026-08-10", amount: 160 }];
    expect(classifyCadence(risen).ratio).toBeGreaterThan(FLAT_SD_RATIO);
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
