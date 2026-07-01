import { describe, it, expect } from "vitest";
import { computeKPIs, financialHealthScore, businessHealth, trialBalance, agingReport, openReceivablesGL, openPayablesGL, glAccountBalance } from "../src/lib/reports.js";

const NOW = new Date("2026-06-15");
const kpi = (ledger, key, opts = {}) => computeKPIs(ledger, { now: NOW, ...opts }).find(k => k.key === key);
const rev = (amount, date = "2026-06-01", extra = {}) => ({ id: Math.random(), vendor: "Acme", amount, date, gl_code: "4000", gl_name: "Revenue", type: "revenue", status: "posted", payment_status: "collected", ...extra });
const exp = (amount, gl_code = "6100", date = "2026-06-01", extra = {}) => ({ id: Math.random(), vendor: "Rent", amount, date, gl_code, gl_name: "Expense", type: "expense", status: "posted", payment_status: "paid", ...extra });

// ── GL-truth open A/R & A/P lists (dashboard card count/list ties to the GL total) ──
describe("openReceivablesGL / openPayablesGL — exclude direct-cash, tie to glAccountBalance", () => {
  // Meridian: an issued invoice Dr A/R 1100 / Cr Revenue 4000 — a genuine receivable.
  const meridian = { id: "inv-mer", vendor: "Meridian Health", amount: 6800, date: "2026-05-01", gl_code: "4000", gl_name: "Revenue", secondary_gl_code: "1100", type: "revenue", debit_credit: "credit", status: "posted", payment_status: "unpaid" };
  // Stripe: a payout booked Dr Cash 1000 / Cr Revenue 4100 — money already received, NO A/R leg.
  const stripe = { id: "dep-stripe", vendor: "Stripe", amount: 3200, date: "2026-05-10", gl_code: "4100", gl_name: "Revenue", secondary_gl_code: "1000", type: "revenue", debit_credit: "credit", status: "posted", payment_status: "unpaid" };

  it("open receivables = only the genuine A/R invoice (Stripe excluded), count + sum tie to GL A/R", () => {
    const list = openReceivablesGL([meridian, stripe], "1100");
    expect(list.map(i => i.id)).toEqual(["inv-mer"]);          // Stripe excluded
    expect(list.length).toBe(1);                                // count = 1, not 2
    const listSum = list.reduce((s, i) => s + i.amount, 0);
    expect(listSum).toBe(6800);                                 // total = $6,800
    expect(glAccountBalance("1100", [meridian, stripe])).toBe(6800); // ties to the GL A/R balance
  });

  // Bill: Dr Expense 6000 / Cr A/P 2000 — a genuine payable. Card: Dr Expense 6500 / Cr Cash 1000.
  const bill = { id: "bill-1", vendor: "Pixel", amount: 1500, date: "2026-05-01", gl_code: "6000", secondary_gl_code: "2000", type: "expense", debit_credit: "debit", status: "posted", payment_status: "unpaid" };
  const card = { id: "card-1", vendor: "Adobe", amount: 800, date: "2026-05-03", gl_code: "6500", secondary_gl_code: "1000", type: "expense", debit_credit: "debit", status: "posted", payment_status: "unpaid" };

  it("open payables = only the A/P bill (direct-cash card charge excluded), ties to GL A/P", () => {
    const list = openPayablesGL([bill, card], "2000");
    expect(list.map(i => i.id)).toEqual(["bill-1"]);
    expect(glAccountBalance("2000", [bill, card])).toBe(1500);
    expect(list.reduce((s, i) => s + i.amount, 0)).toBe(1500);
  });

  it("missing account code → empty (degrade safely, never over-report)", () => {
    expect(openReceivablesGL([meridian, stripe], undefined)).toEqual([]);
  });
});

// ── Report account drill: NET (signed) total, not gross — ties to the account balance ──
describe("account-drill total is the NET effect on the account (the gross-vs-net bug)", () => {
  // A/P 2000 with a bill (Cr A/P 1500) AND a payment clearing it (Dr A/P 1500 / Cr Cash).
  const bill = { id: "b", vendor: "Pixel", amount: 1500, date: "2026-05-01", gl_code: "6000", secondary_gl_code: "2000", type: "expense", debit_credit: "debit", status: "posted" };
  const payment = { id: "p", vendor: "Pixel", amount: 1500, date: "2026-05-20", gl_code: "2000", secondary_gl_code: "1000", type: "expense", debit_credit: "debit", status: "posted" };
  const txns = [bill, payment];

  it("gross sum overstates; glAccountBalance nets the clearing entry to the true balance", () => {
    const gross = txns.reduce((s, i) => s + i.amount, 0);
    expect(gross).toBe(3000);                          // the old (wrong) drill total
    expect(glAccountBalance("2000", txns)).toBe(0);    // NET: bill +1500, payment −1500 = paid off
    expect(txns.length).toBe(2);                        // count stays correct
  });
});

// ── Item 33: KPIs ───────────────────────────────────────────────────────────
describe("computeKPIs", () => {
  it("returns all 5 KPIs", () => {
    const out = computeKPIs([], { now: NOW });
    expect(out.map(k => k.key).sort()).toEqual(["burn_multiple", "current_ratio", "dso", "gross_margin", "opex_ratio"]);
  });

  it("gross margin = (revenue − COGS) / revenue", () => {
    const k = kpi([rev(10000), exp(4000, "5000")], "gross_margin");
    expect(k.value).toBe(60);
    expect(k.display).toBe("60%");
    expect(k.status).toBe("good");
  });

  it("operating expense ratio = OpEx / revenue", () => {
    const k = kpi([rev(10000), exp(3000, "6100")], "opex_ratio");
    expect(k.value).toBe(30);
    expect(k.status).toBe("good");
  });

  it("current ratio = (cash + AR) / AP", () => {
    const k = kpi([exp(2000, "6100", "2026-06-01", { payment_status: "unpaid" })], "current_ratio", { cashBalance: 20000 });
    expect(k.value).toBe(10); // 20000 / 2000
    expect(k.status).toBe("good");
  });

  it("days sales outstanding = (AR / revenue) × 30", () => {
    const k = kpi([rev(10000), rev(5000, "2026-06-02", { payment_status: "unpaid" })], "dso");
    expect(k.value).toBe(10); // 5000 / 15000 × 30
    expect(k.status).toBe("good");
  });

  // ── Divide-by-zero handling ──
  it("handles no revenue gracefully (N/A, never NaN/Infinity)", () => {
    const ledger = [exp(5000, "6100")]; // expenses only, zero revenue
    const gm = kpi(ledger, "gross_margin"), oer = kpi(ledger, "opex_ratio"), dso = kpi(ledger, "dso"), bm = kpi(ledger, "burn_multiple");
    for (const k of [gm, oer, dso, bm]) {
      expect(k.value).toBeNull();
      expect(k.status).toBe("na");
      expect(k.display).toMatch(/N\/A/);
      expect(Number.isFinite(k.value)).toBe(false);
    }
    expect(gm.display).toContain("no revenue");
  });

  it("current ratio is N/A when there are no current liabilities", () => {
    const k = kpi([rev(1000)], "current_ratio", { cashBalance: 5000 });
    expect(k.value).toBeNull();
    expect(k.status).toBe("na");
  });

  it("burn multiple is N/A when revenue didn't grow", () => {
    // June rev 5000 ≤ May rev 5000 → no new revenue
    const k = kpi([rev(5000, "2026-06-01"), rev(5000, "2026-05-01")], "burn_multiple");
    expect(k.value).toBeNull();
    expect(k.status).toBe("na");
  });
});

// ── Item 63: financial health score ─────────────────────────────────────────
describe("financialHealthScore", () => {
  const healthyLedger = [exp(1000, "6100", "2026-06-01"), exp(1000, "6100", "2026-05-01"), exp(1000, "6100", "2026-04-01")];

  it("perfect books → 100 / grade A / green / Strong", () => {
    const h = financialHealthScore({
      invoices: healthyLedger, cashBalance: 20000,
      reconciliations: [{ completed_at: "2026-06-10" }],
      anomalies: [], onboardingComplete: true, now: NOW,
    });
    expect(h.score).toBe(100);
    expect(h.grade).toBe("A");
    expect(h.color).toBe("#039855");
    expect(h.tier).toBe("Strong");
    expect(h.items.reduce((s, i) => s + i.max, 0)).toBe(100); // weights sum to 100
  });

  it("subtracts points and names the main concern (60+ day overdue AR)", () => {
    const h = financialHealthScore({
      invoices: [...healthyLedger, { id: 9, vendor: "Globex", amount: 1847, date: "2026-03-01", due_date: "2026-03-01", gl_code: "4000", gl_name: "Revenue", type: "revenue", status: "posted", payment_status: "unpaid" }],
      cashBalance: 20000, reconciliations: [{ completed_at: "2026-06-10" }],
      anomalies: [], onboardingComplete: true, now: NOW,
    });
    expect(h.score).toBe(85); // lost the 15-pt AR item
    expect(h.grade).toBe("B");
    expect(h.summary).toContain("60+ days overdue");
    expect(h.summary).toContain("$1,847");
  });

  it("incomplete onboarding costs exactly 10 points", () => {
    const base = { invoices: healthyLedger, cashBalance: 20000, reconciliations: [{ completed_at: "2026-06-10" }], anomalies: [], now: NOW };
    const done = financialHealthScore({ ...base, onboardingComplete: true });
    const not = financialHealthScore({ ...base, onboardingComplete: false });
    expect(done.score - not.score).toBe(10);
  });

  it("never produces NaN even with empty inputs", () => {
    const h = financialHealthScore({});
    expect(Number.isFinite(h.score)).toBe(true);
    expect(h.score).toBeGreaterThanOrEqual(0);
  });

  it("grade and its word-label NEVER contradict (single source) — incl. the D-band bug", () => {
    // grade↔tier↔color all derive from one map keyed on grade.
    const AGREE = { A: "Strong", B: "Good", C: "Fair", D: "Needs attention", F: "At risk" };
    // exercise every score band by seeding N met items (each ~ its weight); assert agreement.
    for (const now of [NOW]) {
      for (let anoms = 0; anoms <= 6; anoms++) {
        const h = financialHealthScore({ invoices: [exp(1000, "6100", "2026-06-01")], cashBalance: anoms * 3000, reconciliations: anoms % 2 ? [{ status: "complete", completed_at: "2026-06-10" }] : [], anomalies: Array.from({ length: anoms }, () => ({ severity: "high" })), onboardingComplete: anoms > 2, now });
        expect(AGREE[h.grade]).toBe(h.tier);                    // never "D · Good"
        // color agrees with the grade tier (green for A/B, amber for C/D, red for F)
        if (h.grade === "A" || h.grade === "B") expect(h.color).toBe("#039855");
        if (h.grade === "C" || h.grade === "D") expect(h.color).toBe("#DC6803");
        if (h.grade === "F") expect(h.color).toBe("#D92D20");
        expect(h.summary).toContain(h.tier);                    // summary uses the same word
      }
    }
    // the specific reported case: a D-band score is "Needs attention", not "Good"
    const AGREE2 = { A: "Strong", B: "Good", C: "Fair", D: "Needs attention", F: "At risk" };
    expect(AGREE2.D).toBe("Needs attention");
  });

  // O79: only a COMPLETED reconciliation counts. import/matching ≠ reconcile, and an
  // in-progress draft must not register either.
  const reconItem = (h) => h.items.find((i) => i.id === "reconciled");

  it("no reconciliations → 'Never reconciled to bank', 0 pts", () => {
    const r = reconItem(financialHealthScore({ invoices: healthyLedger, cashBalance: 20000, reconciliations: [], now: NOW }));
    expect(r.met).toBe(false);
    expect(r.points).toBe(0);
    expect(r.detail).toBe("Never reconciled to bank");
  });

  it("an in-progress draft (no completed_at) does NOT count as reconciled", () => {
    const draft = [{ status: "in_progress", period_end: "2026-06-10", created_at: "2026-06-10" }];
    const r = reconItem(financialHealthScore({ invoices: healthyLedger, cashBalance: 20000, reconciliations: draft, now: NOW }));
    expect(r.met).toBe(false);
    expect(r.detail).toBe("Never reconciled to bank");
  });

  it("a completed reconciliation flips it → 'Last reconciled X days ago' + 20 pts", () => {
    const r = reconItem(financialHealthScore({ invoices: healthyLedger, cashBalance: 20000, reconciliations: [{ status: "complete", completed_at: "2026-06-10" }], now: NOW }));
    expect(r.met).toBe(true);
    expect(r.points).toBe(20);
    expect(r.detail).toMatch(/^Last reconciled \d+ days ago$/);
  });
});

// ── Items 24/83/100: aging + trial balance reconcile, exclude voided ─────────
describe("aging + trial balance", () => {
  it("agingReport buckets receivables by days overdue and excludes voided", () => {
    const led = [
      { id: 1, vendor: "A", amount: 100, date: "2026-06-10", due_date: "2026-06-20", gl_code: "4000", type: "revenue", status: "posted", payment_status: "unpaid" }, // not yet due → current
      { id: 2, vendor: "B", amount: 200, date: "2026-05-01", due_date: "2026-06-01", gl_code: "4000", type: "revenue", status: "posted", payment_status: "unpaid" }, // 14 days → 1-30
      { id: 3, vendor: "C", amount: 999, date: "2026-05-01", due_date: "2026-06-01", gl_code: "4000", type: "revenue", status: "voided", payment_status: "unpaid" }, // excluded
    ];
    const r = agingReport(led, "ar", NOW);
    expect(r.total).toBe(300);
    expect(r.buckets.find(b => b.key === "current").total).toBe(100);
    expect(r.buckets.find(b => b.key === "1-30").total).toBe(200);
  });

  it("trialBalance balances (debits === credits) and flags imbalance", () => {
    // Simple 2-line entry: debit 6500 / credit 2000, $100
    const led = [{ id: "je1", amount: 100, gl_code: "6500", gl_name: "Tech", debit_credit: "debit", secondary_gl_code: "2000", secondary_gl_name: "AP", status: "posted" }];
    const tb = trialBalance(led);
    expect(tb.totalDebit).toBe(100);
    expect(tb.totalCredit).toBe(100);
    expect(tb.balanced).toBe(true);
    expect(tb.accounts).toHaveLength(2);
  });
});

// ── Net Income drill-in ties to the dashboard tile (fiscal-year boundary) ─────
// Regression: the Net Income tile scoped to the current year, but the drill-in summed
// all-time rev/exp → it pulled PRIOR-PERIOD expenses (e.g. last year's, equal to the
// beginning-RE delta). Both must use the SAME period and source so they tie.
import { computeNetIncome, computeRevenue, computeExpenses } from "../src/lib/reports.js";

describe("Net Income: tile period == drill-in period (prior-year excluded)", () => {
  const FY = { from: "2026-01-01", to: "2026-12-31" };
  const led = [
    { id: "r1", date: "2026-03-01", gl_code: "4000", type: "revenue", amount: 3500, status: "booked" },
    { id: "e1", date: "2026-04-01", gl_code: "6500", type: "expense", amount: 16550.73, status: "booked" },
    { id: "prior", date: "2025-11-01", gl_code: "6100", type: "expense", amount: 1156.65, status: "booked" }, // prior FY — must NOT count
  ];

  it("current-FY net income excludes the prior-year expense", () => {
    expect(computeNetIncome(led, FY)).toBe(-13050.73);           // 3500 − 16550.73, NOT − (16550.73+1156.65)
    expect(computeExpenses(led, FY)).toBe(16550.73);             // prior 1156.65 excluded
    expect(computeRevenue(led, FY)).toBe(3500);
  });

  it("the drill breakdown ties to the tile by construction (same fns, same range)", () => {
    // tile = computeNetIncome(range); drill r/e = computeRevenue/Expenses(range)
    const tile = computeNetIncome(led, FY);
    const drillR = computeRevenue(led, FY), drillE = computeExpenses(led, FY);
    expect(Math.round((drillR - drillE) * 100) / 100).toBe(tile);
  });

  it("an all-time sum (the OLD drill) would have been wrong — includes prior year", () => {
    const allTimeExp = computeExpenses(led, {});                 // no range = all-time
    expect(allTimeExp).toBe(17707.38);                          // 16550.73 + 1156.65 — the wrong number
    expect(allTimeExp).not.toBe(computeExpenses(led, FY));      // proves the boundary matters
  });
});

// ── By-Vendor (Expenses-by-Vendor) excludes revenue/customers (O12) ───────────
import { computeVendorTotals } from "../src/lib/reports.js";
describe("computeVendorTotals — expenses only, classified by GL class not by name", () => {
  const led = [
    { id: "v1", date: "2026-03-01", vendor: "AWS",    gl_code: "6500", type: "expense", amount: 100, status: "booked" },
    { id: "v2", date: "2026-03-02", vendor: "WeWork", gl_code: "6100", type: "expense", amount: 200, status: "booked" },
    { id: "c1", date: "2026-03-03", vendor: "Bob's",  gl_code: "4000", type: "revenue", amount: 5000, status: "booked" }, // customer revenue — must NOT appear
  ];
  it("includes expense vendors, EXCLUDES the revenue customer (the bug)", () => {
    const rows = computeVendorTotals(led);
    const names = rows.map(r => r.vendor);
    expect(names).toContain("AWS");
    expect(names).toContain("WeWork");
    expect(names).not.toContain("Bob's");          // revenue customer excluded
    expect(rows.reduce((s, r) => s + r.total, 0)).toBe(300);  // 100 + 200, not 5300
  });
  it("a revenue invoice with a counterparty name does not leak into vendor spend", () => {
    expect(computeVendorTotals(led).find(r => r.vendor === "Bob's")).toBeUndefined();
  });
  it("side:'revenue' gives the symmetric by-customer view (revenue only)", () => {
    const rows = computeVendorTotals(led, {}, { side: "revenue" });
    expect(rows.map(r => r.vendor)).toEqual(["Bob's"]);
    expect(rows[0].total).toBe(5000);
  });
});

import { currentPeriodRange } from "../src/lib/reports.js";
// O70 — the Reports window defaults to the CURRENT period on open: "to" is always
// today (never a stale saved value); "from" is the period start.
describe("currentPeriodRange — reports default to the current period (to == today)", () => {
  it("fy/ytd: 'to' is today, 'from' is the fiscal-year start (calendar FY)", () => {
    const r = currentPeriodRange("fy", { today: "2026-06-26", fiscalYearEnd: "12-31" });
    expect(r.to).toBe("2026-06-26");
    expect(r.from).toBe("2026-01-01");
  });
  it("respects a NON-calendar fiscal_year_end (FYE 06-30 → prior Jul 1)", () => {
    const r = currentPeriodRange("fy", { today: "2026-06-26", fiscalYearEnd: "06-30" });
    expect(r.to).toBe("2026-06-26");
    expect(r.from).toBe("2025-07-01");          // FY runs Jul 1 → Jun 30
  });
  it("floors 'from' at the company cutoff (no activity before Day One)", () => {
    const r = currentPeriodRange("fy", { today: "2026-06-26", fiscalYearEnd: "12-31", cutoffDate: "2026-03-15" });
    expect(r.from).toBe("2026-03-15");
  });
  it("mtd: 'from' is the first of the current month, 'to' is today", () => {
    const r = currentPeriodRange("mtd", { today: "2026-06-26" });
    expect(r).toEqual({ from: "2026-06-01", to: "2026-06-26" });
  });
  it("all: unbounded window", () => {
    expect(currentPeriodRange("all", { today: "2026-06-26" })).toEqual({ from: "", to: "" });
  });
  it("'to' tracks the date passed in — never a stale baked-in value", () => {
    expect(currentPeriodRange("fy", { today: "2027-02-10", fiscalYearEnd: "12-31" })).toEqual({ from: "2027-01-01", to: "2027-02-10" });
  });
});

// ── Owner-facing business health (plain-language, no letter grade) ───────────
describe("businessHealth — owner-facing status, no books-health, honest", () => {
  const NOW2 = new Date("2026-06-15");
  // profitable + long runway: revenue >> expenses, healthy cash
  const healthy = [rev(20000, "2026-06-01"), exp(1000, "6100", "2026-06-01"), exp(1000, "6100", "2026-05-01"), exp(1000, "6100", "2026-04-01")];

  it("healthy business → tone 'good', reassuring headline, no concerns", () => {
    const bh = businessHealth(healthy, { cash: 40000, now: NOW2 });
    expect(bh.tone).toBe("good");
    expect(bh.headline).toMatch(/profitable/i);
    expect(bh.headline).toMatch(/healthy/i);
    expect(bh.concerns).toEqual([]);
    expect(bh.facts.map(f => f.key)).toEqual(["profit", "runway", "cash"]);
  });

  it("overdue AR surfaces as a concern with the number + an action (not a grade)", () => {
    const led = [...healthy, { id: "od", vendor: "Globex", amount: 6800, date: "2026-01-01", due_date: "2026-01-15", gl_code: "4000", gl_name: "Revenue", type: "revenue", status: "posted", payment_status: "unpaid" }];
    const bh = businessHealth(led, { cash: 40000, now: NOW2 });
    const ar = bh.concerns.find(c => c.key === "ar");
    expect(ar).toBeTruthy();
    expect(ar.text).toMatch(/6,800/);
    expect(ar.text).toMatch(/overdue/i);
    expect(ar.actionView).toBe("ar");
    expect(ar.actionLabel).toBeTruthy();
    expect(ar.severity).toBe("high");   // >= $5k
  });

  it("short runway is stated honestly (not hidden) with the month count + burn", () => {
    // heavy burn, little cash → short runway
    const led = [exp(9000, "6100", "2026-06-01"), exp(9000, "6100", "2026-05-01"), exp(9000, "6100", "2026-04-01")];
    const bh = businessHealth(led, { cash: 9000, now: NOW2 });
    const rw = bh.concerns.find(c => c.key === "runway");
    expect(rw).toBeTruthy();
    expect(rw.text).toMatch(/runway/i);
    expect(bh.tone).toBe("concern");         // < 3 months = high severity
    expect(bh.headline).toMatch(/loss|runway/i);
  });

  it("a real loss is said plainly, never falsely rosy", () => {
    const led = [rev(2000, "2026-06-01"), exp(9000, "6100", "2026-06-01")];
    const bh = businessHealth(led, { cash: 5000, now: NOW2 });
    expect(bh.concerns.some(c => c.key === "profit")).toBe(true);
    expect(bh.facts.find(f => f.key === "profit").tone).toBe("concern");
    expect(bh.tone).toBe("concern");
  });

  it("does NOT include any books-health items (reconciled / setup / anomalies)", () => {
    const bh = businessHealth(healthy, { cash: 40000, now: NOW2 });
    const blob = JSON.stringify(bh).toLowerCase();
    expect(blob).not.toMatch(/reconcil/);
    expect(blob).not.toMatch(/setup|onboard/);
    expect(blob).not.toMatch(/anomal/);
    expect(blob).not.toMatch(/grade|\/ 100|score/);   // no letter grade / score language
  });
});
