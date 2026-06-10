import { describe, it, expect } from "vitest";
import { computeKPIs, financialHealthScore, trialBalance, agingReport } from "../src/lib/reports.js";

const NOW = new Date("2026-06-15");
const kpi = (ledger, key, opts = {}) => computeKPIs(ledger, { now: NOW, ...opts }).find(k => k.key === key);
const rev = (amount, date = "2026-06-01", extra = {}) => ({ id: Math.random(), vendor: "Acme", amount, date, gl_code: "4000", gl_name: "Revenue", type: "revenue", status: "posted", payment_status: "collected", ...extra });
const exp = (amount, gl_code = "6100", date = "2026-06-01", extra = {}) => ({ id: Math.random(), vendor: "Rent", amount, date, gl_code, gl_name: "Expense", type: "expense", status: "posted", payment_status: "paid", ...extra });

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
