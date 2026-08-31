import { describe, it, expect } from "vitest";
import { runAnomalyDetection } from "../src/lib/insights.js";

// ─────────────────────────────────────────────────────────────────────────────
// ★★★ A CARD THE USER SEES EVERY MONTH IS A BUG WEARING A QUESTION MARK (O122).
//
// The detectors are tested on fixtures built to TRIP them. That proves each one CAN fire; it
// says nothing about whether they fire on ordinary bookkeeping — and that is the failure that
// costs, because a client who is asked the same pointless question every month stops reading
// the questions. §11 records four instances of exactly this: payroll tripping the large-charge
// detector, staleness measured against wall-clock, duplicates firing on the invoice-to-payment
// lifecycle, and a weekly flat-fee vendor flagged as a double payment every week.
//
// ★★ SO THIS FEEDS THEM A HEALTHY, ORDINARY YEAR AND ASSERTS SILENCE — then breaks one thing
// at a time and asserts the matching detector speaks. Both directions, because "no cards" is
// equally satisfied by a detector that can never fire.
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date(2026, 7, 31, 12, 0, 0);   // local, not a UTC instant (C290)
const ymd = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// An ordinary restaurant year: steady suppliers, a monthly landlord, weekly linen at a flat
// fee, twice-monthly payroll, card settlements. Nothing here is unusual.
function healthyLedger() {
  const out = [];
  let id = 0;
  const add = (o) => out.push({ id: `n${id++}`, status: "booked", ...o });
  for (let m = 1; m <= 8; m++) {
    // Food suppliers — varying amounts, several times a month.
    for (const [d, vendor, base] of [[4, "Roma Cheese", 1450], [11, "Roma Cheese", 1502], [18, "Hill Country Milling", 1180], [25, "Hill Country Milling", 1211]]) {
      add({ vendor, amount: Math.round((base + m * 7.13) * 100) / 100, date: ymd(2026, m, d), gl_code: "5000", gl_name: "COGS", type: "expense" });
    }
    // ★ A GENUINELY FLAT WEEKLY VENDOR — identical to the cent, every week. The O117 case.
    for (const d of [3, 10, 17, 24]) {
      add({ vendor: "Bluebonnet Linen", amount: 145, date: ymd(2026, m, d), gl_code: "6100", gl_name: "Rent & Occupancy", type: "expense" });
    }
    // Monthly rent — a large, identical, entirely normal charge.
    add({ vendor: "Franklin Ave Properties", amount: 4200, date: ymd(2026, m, 3), gl_code: "6100", gl_name: "Rent & Occupancy", type: "expense" });
    // Payroll, twice a month, identical gross — a round number and a large charge, both normal.
    for (const d of [15, 28]) {
      add({ vendor: "Gusto Payroll", amount: 5500, date: ymd(2026, m, d), gl_code: "6000", gl_name: "Salaries", type: "expense", source: "payroll" });
    }
    // Revenue.
    for (const d of [7, 14, 21, 28]) {
      add({ vendor: "Toast POS", amount: Math.round((9200 + m * 31.7) * 100) / 100, date: ymd(2026, m, d), gl_code: "4000", gl_name: "Sales", type: "revenue" });
    }
  }
  return out;
}

const cards = (ledger, recurring = []) => runAnomalyDetection(ledger, recurring, NOW);
const byType = (ledger, recurring = []) => {
  const out = {};
  for (const c of cards(ledger, recurring)) out[c.type] = (out[c.type] || 0) + 1;
  return out;
};

describe("★★★ an ordinary year raises no questions", () => {
  const found = byType(healthyLedger());

  it("reports what it found, so a failure is legible", () => {
    console.log(`\n  cards on a healthy 8-month ledger: ${JSON.stringify(found)}\n`);
    expect(typeof found).toBe("object");
  });

  it("★★ a flat weekly vendor is not a duplicate payment — the O117 case, four times a month", () => {
    expect(found.duplicate_payment || 0).toBe(0);
  });

  it("★★ payroll does not trip the large-charge or round-number detectors", () => {
    // §11: the large-charge and round-number detectors once flagged a $4,000 payroll gross as
    // "may need to be capitalized" — nonsense for a payroll leg.
    const payrollCards = cards(healthyLedger()).filter((c) => /gusto|payroll/i.test(String(c.vendor || "") + String(c.title || "") + String(c.description || "")));
    expect(payrollCards).toEqual([]);
  });

  it("★ identical monthly rent is not a spike, a duplicate, or a round-number flag", () => {
    const rentCards = cards(healthyLedger()).filter((c) => /franklin/i.test(String(c.vendor || "") + String(c.description || "")));
    expect(rentCards).toEqual([]);
  });

  it("★★★ and the TOTAL is small enough to be read — under 5% of documents (O122's steady-state target)", () => {
    const docs = healthyLedger().length;
    const total = cards(healthyLedger()).length;
    expect(docs).toBeGreaterThan(100);
    if (total / docs >= 0.05) throw new Error(`${total} cards on ${docs} documents = ${(total / docs * 100).toFixed(1)}% — over the 5% steady-state target`);
  });
});

describe("★★★ and the detectors still fire on the things they exist for", () => {
  it("a genuine duplicate — same vendor, same amount, days apart", () => {
    const l = healthyLedger();
    l.push({ id: "dup1", vendor: "Alamo Fire & Safety", amount: 462.85, date: ymd(2026, 8, 12), gl_code: "6250", type: "expense", status: "booked" });
    l.push({ id: "dup2", vendor: "Alamo Fire & Safety", amount: 462.85, date: ymd(2026, 8, 14), gl_code: "6250", type: "expense", status: "booked" });
    expect((byType(l).duplicate_payment || 0)).toBeGreaterThan(0);
  });

  it("a genuinely out-of-character charge for a vendor", () => {
    const l = healthyLedger();
    l.push({ id: "spike", vendor: "Roma Cheese", amount: 48000, date: ymd(2026, 8, 20), gl_code: "5000", type: "expense", status: "booked" });
    const f = byType(l);
    expect((f.vendor_spike || 0) + (f.large_transaction || 0)).toBeGreaterThan(0);
  });

  it("★ a MONTHLY charge that stopped arriving", () => {
    // ★ SCOPE LIMIT, RECORDED RATHER THAN CLAIMED AS A DEFECT: the detector keys on gaps of
    // 25-40 days and says so in its own copy ("usually bills about monthly"). A WEEKLY vendor
    // that stops is not caught — my first version of this test used one and read the silence
    // as a bug. Whether weekly cadence deserves the same treatment is a product question.
    // ★ THE DETECTOR IS NARROWER THAN IT LOOKS, AND MY FIXTURE MISSED IT TWICE. It needs TWO
    // charges inside a 95-day window to establish the cadence, AND a last charge 35+ days old.
    // A vendor that stopped four months ago has nothing in the window and is no longer news —
    // a sensible rule, and the reason my earlier cuts saw silence. Cut from August → June and
    // July are both in the window, last charge 3 July, ~56 days old.
    const l = healthyLedger().filter((e) => !(e.vendor === "Franklin Ave Properties" && e.date >= "2026-08"));
    expect((byType(l).missing_recurring || 0)).toBeGreaterThan(0);
  });

  it("★★★ ONE prior similar charge is a coincidence; TWO is a pattern — the bar, pinned", () => {
    // A surviving mutation showed my tests could not tell `< 2` from `< 1`: the spike fixture
    // uses amounts nowhere near its priors, so the count was 0 either way. This distinguishes
    // them, because the bar is a judgement and an unpinned judgement drifts.
    const withPriors = (n) => {
      const l = healthyLedger();
      for (let k = 0; k < n; k++) l.push({ id: `pri${k}`, vendor: "Kitchen Systems Co", amount: 9000, date: ymd(2026, 5 + k, 9), gl_code: "6250", type: "expense", status: "booked" });
      l.push({ id: "subject", vendor: "Kitchen Systems Co", amount: 9000, date: ymd(2026, 8, 9), gl_code: "6250", type: "expense", status: "booked" });
      // ★ COUNT THE SUBJECT'S OWN CARD, not the type total: the earlier priors are themselves
      // large and in the window, so they raise their own cards and a bare count cannot tell
      // which entry was flagged. My first version asserted the total and failed on its own noise.
      return cards(l).filter((c) => c.type === "large_transaction" && (c.invoice_ids || []).includes("subject")).length;
    };
    expect(withPriors(0)).toBeGreaterThan(0);   // a first large charge is worth asking about
    expect(withPriors(1)).toBeGreaterThan(0);   // once could be a one-off
    expect(withPriors(2)).toBe(0);              // twice is how this vendor bills
  });

  it("★★ and the SAME ledger without the break stays quiet — so each failure above is the break, not the fixture", () => {
    const base = byType(healthyLedger());
    expect(base.duplicate_payment || 0).toBe(0);
    expect(base.vendor_spike || 0).toBe(0);
    expect(base.missing_recurring || 0).toBe(0);
  });
});
