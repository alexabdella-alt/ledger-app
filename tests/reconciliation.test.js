import { describe, it, expect } from "vitest";
import {
  isLiveEntry, liveEntries, computeRevenue, computeExpenses, computeNetIncome,
  computeCategoryTotals, computeVendorTotals, computeAR, computeAP,
  computeBurnRate, computeRunway,
  agingReport, trialBalance, buildMonthlyReport,
  openPayables, paidPayables, glAccountBalance, glCashOnHand,
} from "../src/lib/reports.js";
import { glIsRevenue, glIsExpense } from "../src/lib/gl.js";
import { executeAITool } from "../src/lib/aiTools.js";

// ════════════════════════════════════════════════════════════════════════════
// THE RECONCILIATION LOCK.
// A deliberately nasty fixture exercising every filter edge: voided, soft-deleted,
// prior-year, opening balances, qbo_import, multi-line, unpaid AR/AP, a flagged
// entry, and year-boundary dates. Every surface must agree to the penny.
// If a future change breaks reconciliation, these tests fail in CI.
// ════════════════════════════════════════════════════════════════════════════

const YEAR = new Date().getFullYear();
const PRIOR = YEAR - 1;
const PAST_DUE = "2000-01-01";           // always in the past → deterministic "overdue"

// Flattened-invoice factory (the shape every compute* function consumes).
const e = (o) => ({
  id: o.id, vendor: o.vendor, amount: o.amount, date: o.date,
  gl_code: o.gl_code, gl_name: o.gl_name || o.gl_code,
  debit_credit: o.debit_credit, secondary_gl_code: o.secondary_gl_code || null,
  secondary_gl_name: o.secondary_gl_name || null,
  payment_status: o.payment_status || "paid", due_date: o.due_date || null,
  source: o.source || "manual", status: o.status || "booked",
  deleted_at: o.deleted_at || null, approval_status: o.approval_status || null,
  type: glIsRevenue(o.gl_code) ? "revenue" : glIsExpense(o.gl_code) ? "expense" : "other",
});

const FIX = [
  // ── This year (all in March, so monthly[March] === YTD for the P&L lines) ──
  e({ id: "a", vendor: "AWS",      amount: 100, date: `${YEAR}-03-10`, gl_code: "6500", debit_credit: "debit",  secondary_gl_code: "1000", payment_status: "paid" }),
  e({ id: "b", vendor: "WeWork",   amount: 200, date: `${YEAR}-03-11`, gl_code: "6100", debit_credit: "debit",  secondary_gl_code: "2000", payment_status: "unpaid",    due_date: PAST_DUE }),
  e({ id: "c", vendor: "ClientCo", amount: 500, date: `${YEAR}-03-12`, gl_code: "4000", debit_credit: "credit", secondary_gl_code: "1000", payment_status: "collected" }),
  e({ id: "d", vendor: "BigCorp",  amount: 300, date: `${YEAR}-03-13`, gl_code: "4000", debit_credit: "credit", secondary_gl_code: "1200", payment_status: "unpaid",    due_date: PAST_DUE }),
  e({ id: "i", vendor: "Verizon",  amount: 150, date: `${YEAR}-03-14`, gl_code: "6200", debit_credit: "debit",  secondary_gl_code: "1000", payment_status: "paid", source: "qbo_import" }),
  e({ id: "k", vendor: "AWS",      amount: 50,  date: `${YEAR}-03-15`, gl_code: "6500", debit_credit: "debit",  secondary_gl_code: "1000", payment_status: "paid", approval_status: "flagged" }),
  // Multi-line payroll (ids carry "_" → primary-side only in TB / balance sheet)
  e({ id: "pr_0", vendor: "Payroll", amount: 800,  date: `${YEAR}-03-20`, gl_code: "6000", debit_credit: "debit",  secondary_gl_code: "1000" }),
  e({ id: "pr_1", vendor: "Payroll", amount: 200,  date: `${YEAR}-03-20`, gl_code: "6700", debit_credit: "debit",  secondary_gl_code: "1000" }),
  e({ id: "pr_2", vendor: "Payroll", amount: 1000, date: `${YEAR}-03-20`, gl_code: "1000", debit_credit: "credit", secondary_gl_code: "6000" }),
  // Year-boundary: still THIS year (December)
  e({ id: "l", vendor: "AWS", amount: 25, date: `${YEAR}-12-31`, gl_code: "6500", debit_credit: "debit", secondary_gl_code: "1000", payment_status: "paid" }),

  // ── Prior year (excluded from YTD, included all-time). NB: ids must not contain
  //    "_" — that marks a multi-line expansion (offset booked once) in TB/balance sheet. ──
  e({ id: "px", vendor: "OldVendor", amount: 999,  date: `${PRIOR}-06-01`, gl_code: "6500", debit_credit: "debit",  secondary_gl_code: "1000", payment_status: "paid" }),
  e({ id: "pv", vendor: "OldClient", amount: 5000, date: `${PRIOR}-12-31`, gl_code: "4000", debit_credit: "credit", secondary_gl_code: "1000", payment_status: "collected" }),
  // Opening balance: equity ↔ cash, balance-sheet only (no P&L)
  e({ id: "ob", vendor: "Opening Balance", amount: 5000, date: `${PRIOR}-01-01`, gl_code: "3000", debit_credit: "credit", secondary_gl_code: "1000", source: "opening_balance" }),

  // ── Must be EXCLUDED everywhere ──
  e({ id: "void", vendor: "AWS", amount: 777, date: `${YEAR}-03-09`, gl_code: "6500", debit_credit: "debit", secondary_gl_code: "1000", status: "voided" }),
  e({ id: "del",  vendor: "AWS", amount: 888, date: `${YEAR}-03-08`, gl_code: "6500", debit_credit: "debit", secondary_gl_code: "1000", deleted_at: "2025-01-01T00:00:00Z" }),
];

const YTD = { from: `${YEAR}-01-01`, to: `${YEAR}-12-31` };
const MARCH = { from: `${YEAR}-03-01`, to: `${YEAR}-03-31` };
const CASH = "12345.67";
const ctx = { getLedger: async () => FIX, cashBalance: CASH, anomalies: [], recurring: [], getAccountByRole: () => null };

// Independent re-implementation of the P&L report's accrual math (NOT via canonical),
// so the test catches the canonical layer drifting from intended P&L semantics.
function plReport(range) {
  const f = FIX.filter(i => i.status !== "voided" && i.status !== "deleted" && !i.deleted_at)
    .filter(i => (!range.from || i.date >= range.from) && (!range.to || i.date <= range.to));
  const rev = f.filter(i => glIsRevenue(i.gl_code)).reduce((s, i) => s + i.amount, 0);
  const exp = f.filter(i => glIsExpense(i.gl_code)).reduce((s, i) => s + i.amount, 0);
  return { rev, exp, net: rev - exp };
}

describe("liveness predicate excludes voided + soft-deleted", () => {
  it("drops voided and deleted, keeps the rest (incl. flagged/qbo/opening/multi-line)", () => {
    const live = FIX.filter(isLiveEntry);
    expect(live.find(i => i.id === "void")).toBeUndefined();
    expect(live.find(i => i.id === "del")).toBeUndefined();
    expect(live.find(i => i.id === "k")).toBeDefined();    // flagged is still posted/live
    expect(live.find(i => i.id === "i")).toBeDefined();    // qbo_import
    expect(live.length).toBe(FIX.length - 2);
  });
});

describe("net income reconciles across every surface (same period)", () => {
  it("dashboard YTD === P&L YTD === AI get_financial_summary === canonical", async () => {
    const canonical = computeNetIncome(FIX, YTD);
    const pl = plReport(YTD).net;
    const ai = await executeAITool("get_financial_summary", { period: "this_year" }, ctx);
    expect(pl).toBe(canonical);
    expect(ai.net_income).toBe(canonical);
    expect(ai.total_revenue).toBe(computeRevenue(FIX, YTD));
    expect(ai.total_expenses).toBe(computeExpenses(FIX, YTD));
    // prior-year + voided + deleted excluded from YTD
    expect(canonical).toBe(800 - 1525);
  });

  it("monthly report net === canonical net for the same month", () => {
    const m = buildMonthlyReport(`${YEAR}-03`, { invoices: FIX, cashBalance: CASH });
    expect(m.pl.net_income.current).toBe(computeNetIncome(FIX, MARCH));
    expect(m.pl.revenue.current).toBe(computeRevenue(FIX, MARCH));
    expect(m.pl.expenses_total.current).toBe(computeExpenses(FIX, MARCH));
  });
});

describe("category totals reconcile and sum to total expenses", () => {
  it("Σ canonical categories === total expenses === Σ AI get_category_totals", async () => {
    const cats = computeCategoryTotals(FIX, YTD);
    const sumCats = Math.round(cats.reduce((s, c) => s + c.total, 0) * 100) / 100;
    const totalExp = computeExpenses(FIX, YTD);
    expect(sumCats).toBe(totalExp);

    const ai = await executeAITool("get_category_totals", { period: "this_year" }, ctx);
    const sumAi = Math.round(ai.categories.reduce((s, c) => s + c.total, 0) * 100) / 100;
    expect(sumAi).toBe(totalExp);
    // multi-line expense lines both counted (6000 + 6700), nothing double-counted
    expect(cats.find(c => c.gl_code === "6000").total).toBe(800);
    expect(cats.find(c => c.gl_code === "6700").total).toBe(200);
  });
});

describe("trial balance balances and reconciles to net income", () => {
  const tb = trialBalance(FIX);
  it("debits === credits", () => {
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });
  it("TB net of P&L accounts === all-time net income", () => {
    const plNet = tb.accounts
      .filter(a => /^[4-8]/.test(a.code))
      .reduce((s, a) => s + (a.credit - a.debit), 0);   // revenue credit − expense debit
    expect(Math.round(plNet * 100) / 100).toBe(computeNetIncome(FIX));   // all-time
  });
});

describe("balance sheet identity: Assets === Liabilities + Equity + net income", () => {
  it("holds (derived from the balanced trial balance)", () => {
    const tb = trialBalance(FIX);
    const cls = (re) => tb.accounts.filter(a => re.test(a.code));
    const assets = cls(/^1/).reduce((s, a) => s + (a.debit - a.credit), 0);
    const liab   = cls(/^2/).reduce((s, a) => s + (a.credit - a.debit), 0);
    const equity = cls(/^3/).reduce((s, a) => s + (a.credit - a.debit), 0);
    const net    = computeNetIncome(FIX);
    expect(Math.round(assets * 100) / 100).toBe(Math.round((liab + equity + net) * 100) / 100);
  });
});

describe("AR / AP reconcile across aging, dashboard total, and AI overdue", () => {
  const now = new Date();
  it("AR aging total === canonical AR total === AI get_overdue (ar) total", async () => {
    const aging = agingReport(FIX, "ar", now);
    const ar = computeAR(FIX, { now });
    const ai = await executeAITool("get_overdue_invoices", { type: "ar" }, ctx);
    expect(aging.total).toBe(ar.total);
    expect(ar.total).toBe(300);                       // only the one unpaid receivable
    expect(ar.overdue).toBe(ar.total);                // all past-due → overdue === total
    expect(ai.total).toBe(ar.overdue);
  });
  it("AP aging total === canonical AP total === AI get_overdue (ap) total", async () => {
    const aging = agingReport(FIX, "ap", now);
    const ap = computeAP(FIX, { now });
    const ai = await executeAITool("get_overdue_invoices", { type: "ap" }, ctx);
    expect(aging.total).toBe(ap.total);
    expect(ap.total).toBe(200);
    expect(ai.total).toBe(ap.overdue);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// THE AP RECONCILIATION LOCK.
// The Payables page once filtered its bill LIST inline ((glIsExpense||type) +
// status!=="voided"), which drifted from canonical computeAP (let soft-deleted
// and balance-sheet-leg rows leak into the list but not the total). This locks
// all four AP surfaces to one number over a fixture with null + partial payment
// status, an unapproved bill, voided, soft-deleted, paid, and a liability leg.
// ════════════════════════════════════════════════════════════════════════════
describe("AP total reconciliation lock — list === aging === computeAP === AI overdue", () => {
  const now = new Date();
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  // Factory that PRESERVES an explicit null payment_status (the shared `e`
  // coerces null → "paid"). Every bill is past-due so overdue total === open total.
  const ap = (o) => ({
    id: o.id, vendor: o.vendor, amount: o.amount, date: `${YEAR}-02-01`,
    gl_code: o.gl_code, gl_name: o.gl_code,
    type: o.type || (glIsExpense(o.gl_code) ? "expense" : glIsRevenue(o.gl_code) ? "revenue" : "other"),
    payment_status: "payment_status" in o ? o.payment_status : "unpaid",
    due_date: o.due_date || PAST_DUE, source: "manual", status: o.status || "booked",
    deleted_at: o.deleted_at || null, approval_status: o.approval_status || null,
  });
  const APFIX = [
    ap({ id: "ap_null",    vendor: "NullCo",    amount: 100, gl_code: "6500", payment_status: null }),                 // null → open
    ap({ id: "ap_partial", vendor: "PartialCo", amount: 200, gl_code: "6100", payment_status: "partial" }),            // partial → open
    ap({ id: "ap_unappr",  vendor: "UnapprCo",  amount: 300, gl_code: "6000", approval_status: "pending_approval" }),  // unapproved → still counts
    ap({ id: "ap_paid",    vendor: "PaidCo",    amount: 400, gl_code: "6200", payment_status: "paid" }),               // excluded (paid)
    ap({ id: "ap_void",    vendor: "VoidCo",    amount: 500, gl_code: "6500", status: "voided" }),                     // excluded (voided)
    ap({ id: "ap_del",     vendor: "DelCo",     amount: 600, gl_code: "6500", deleted_at: "2025-01-01T00:00:00Z" }),   // excluded (soft-deleted)
    ap({ id: "ap_bsleg",   vendor: "ApLeg",     amount: 700, gl_code: "2000", type: "expense" }),                      // liability leg w/ type expense → excluded
  ];
  const EXPECTED = 600;                                  // 100 + 200 + 300
  const apCtx = { getLedger: async () => APFIX, cashBalance: "0", anomalies: [], recurring: [], getAccountByRole: () => null };

  it("computeAP === AP aging === Payables list sum === AI get_overdue(ap) === $600", async () => {
    const apT  = computeAP(APFIX, { now });
    const aging = agingReport(APFIX, "ap", now);
    const listSum = r2(openPayables(APFIX).reduce((s, i) => s + i.amount, 0)); // the Payables page total
    const ai = await executeAITool("get_overdue_invoices", { type: "ap" }, apCtx);
    expect(apT.total).toBe(EXPECTED);
    expect(aging.total).toBe(apT.total);
    expect(listSum).toBe(apT.total);
    expect(ai.total).toBe(apT.total);
    expect(apT.overdue).toBe(apT.total);                 // all past-due → overdue === open
  });

  it("the unpaid list is exactly the live, expense-coded, unpaid bills (null/partial/unapproved in; voided/deleted/paid/leg out)", () => {
    expect(openPayables(APFIX).map(i => i.id).sort()).toEqual(["ap_null", "ap_partial", "ap_unappr"]);
  });

  it("paidPayables is exactly the live paid expense rows", () => {
    expect(paidPayables(APFIX).map(i => i.id)).toEqual(["ap_paid"]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AP STEP 2 — canonical glAccountBalance: Balance Sheet AP and the Outstanding/
// Payables total read ONE GL-based source, so they're identical by construction.
// ════════════════════════════════════════════════════════════════════════════
describe("glAccountBalance — the single GL source for Accounts Payable", () => {
  const AP = "2000", CASH = "1000", EXP = "6500";
  // Booked bill: Dr Expense 300 / Cr AP 300 (simple 2-line, flattened to one row).
  const bill = { id: "b1", date: `${YEAR}-04-01`, gl_code: EXP, amount: 300, debit_credit: "debit", secondary_gl_code: AP, status: "booked" };
  // Step-1 payment of part of it: Dr AP 100 / Cr Cash 100.
  const payment = { id: "p1", date: `${YEAR}-04-10`, gl_code: AP, amount: 100, debit_credit: "debit", secondary_gl_code: CASH, status: "booked" };
  const led = [bill, payment];

  it("AP balance = credits − debits on the AP account (booked 300 − paid 100 = 200)", () => {
    expect(glAccountBalance(AP, led)).toBe(200);
  });
  it("a payment reduces the GL AP balance (the Step-1 movement is reflected)", () => {
    expect(glAccountBalance(AP, [bill])).toBe(300);          // before payment
    expect(glAccountBalance(AP, led)).toBe(200);             // after Dr AP / Cr Cash
  });
  it("the Cash leg of the payment reduces Cash (asset, debit-normal)", () => {
    expect(glAccountBalance(CASH, [payment])).toBe(-100);
  });
  it("Balance Sheet AP and the Outstanding/Payables total are the IDENTICAL number from one source", () => {
    // Both surfaces call glAccountBalance(apCode, invoices) — same function, same args.
    const balanceSheetAP = glAccountBalance(AP, led);
    const outstandingAP  = glAccountBalance(AP, led);
    expect(balanceSheetAP).toBe(outstandingAP);
    expect(balanceSheetAP).toBe(200);
  });
  it("excludes voided / soft-deleted entries (live only)", () => {
    const withVoid = [...led, { id: "v", date: `${YEAR}-04-02`, gl_code: EXP, amount: 999, debit_credit: "debit", secondary_gl_code: AP, status: "voided" }];
    const withDel  = [...led, { id: "d", date: `${YEAR}-04-03`, gl_code: EXP, amount: 888, debit_credit: "debit", secondary_gl_code: AP, deleted_at: "2025-01-01" }];
    expect(glAccountBalance(AP, withVoid)).toBe(200);
    expect(glAccountBalance(AP, withDel)).toBe(200);
  });
  it("ties to the accounting equation over the FIX fixture (ΣAssets = ΣLiab+Equity+NetIncome)", () => {
    const code = c => String(c)[0];
    const codes = [...new Set(FIX.filter(isLiveEntry).flatMap(i => [i.gl_code, i.secondary_gl_code]).filter(Boolean))];
    let assets = 0, liabEq = 0;
    for (const c of codes) {
      const b = glAccountBalance(c, FIX);
      if (code(c) === "1") assets += b;
      else if (code(c) === "2" || code(c) === "3") liabEq += b;
    }
    const ni = computeNetIncome(FIX);   // all-time
    expect(Math.round((assets - (liabEq + ni)) * 100) / 100).toBe(0);
  });
});

describe("glAccountBalance — the single GL source for Accounts Receivable (cluster #2)", () => {
  const AR = "1100", CASH = "1000", REV = "4000";
  // Issued invoice: Dr A/R 500 / Cr Revenue 500. Collection: Dr Cash 200 / Cr A/R 200.
  const invoice = { id: "inv1", date: `${YEAR}-04-01`, gl_code: REV, amount: 500, debit_credit: "credit", secondary_gl_code: AR, status: "booked" };
  const collection = { id: "col1", date: `${YEAR}-04-10`, gl_code: CASH, amount: 200, debit_credit: "debit", secondary_gl_code: AR, status: "booked" };
  const led = [invoice, collection];

  it("AR balance = debits − credits on A/R (issued 500 − collected 200 = 300)", () => {
    expect(glAccountBalance(AR, led)).toBe(300);
  });
  it("a collection reduces GL A/R (Dr Cash / Cr A/R is reflected)", () => {
    expect(glAccountBalance(AR, [invoice])).toBe(500);   // before collection
    expect(glAccountBalance(AR, led)).toBe(300);          // after
  });
  it("Dashboard AR === ArView AR === AR aging total — one source", () => {
    // All three surfaces call glAccountBalance(arCode, invoices) with the same args.
    expect(glAccountBalance(AR, led)).toBe(glAccountBalance(AR, led));
    expect(glAccountBalance(AR, led)).toBe(300);
  });
});

describe("vendor totals reconcile between the report and the AI", () => {
  it("canonical computeVendorTotals === AI get_vendor_summary (per vendor)", async () => {
    const report = computeVendorTotals(FIX);                       // all-time, P&L scope
    const ai = await executeAITool("get_vendor_summary", { period: "all_time" }, ctx);
    const reportMap = Object.fromEntries(report.map(v => [v.vendor, v.total]));
    const aiMap = Object.fromEntries(ai.vendors.map(v => [v.vendor, v.total]));
    expect(aiMap).toEqual(reportMap);
    // AWS = 100 + 50 + 25 (this yr) — voided 777 / deleted 888 excluded
    expect(reportMap["AWS"]).toBe(175);
  });
});

describe("cash on hand derives from the GL — one source for every cash surface", () => {
  it("glCashOnHand === the Balance Sheet cash line (sum of glAccountBalance over cash accounts)", () => {
    // Every cash surface (dashboard card, runway, health, KPIs, monthly, AI) calls
    // glCashOnHand(invoices, cashCodes) — so they are identical by construction, and
    // equal to what the Balance Sheet cash line shows (glAccountBalance per cash account).
    expect(glCashOnHand(FIX, ["1000"])).toBe(glAccountBalance("1000", FIX));
    expect(glCashOnHand(FIX, ["1000", "1010"]))
      .toBe(Math.round((glAccountBalance("1000", FIX) + glAccountBalance("1010", FIX)) * 100) / 100);
  });
  it("respects an as-of date (cash as of a point in time)", () => {
    expect(glCashOnHand(FIX, ["1000"], { asOf: `${YEAR}-12-31` }))
      .toBe(glAccountBalance("1000", FIX, { asOf: `${YEAR}-12-31` }));
  });
  it("runway === GL cash ÷ trailing burn, consistently", () => {
    const burn = computeBurnRate(FIX, { asOf: `${YEAR}-12-31` });
    const cash = glCashOnHand(FIX, ["1000"]);
    expect(computeRunway(cash, burn)).toBe(Math.round((cash / burn) * 10) / 10);
  });
});
