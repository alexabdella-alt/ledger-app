import { describe, it, expect } from "vitest";
import { buildPaymentEntry, paymentEntryLines } from "../src/lib/payments.js";
import { reverseEntryLines, buildYearEndCloseEntry } from "../src/lib/journalEntries.js";
import { buildOpeningBalanceEntry } from "../src/lib/openingBalances.js";
import { buildDepreciationEntry } from "../src/lib/depreciation.js";
import { buildDeferredRevenueReceiptEntry, buildArInvoiceEntry } from "../src/lib/revenueEntries.js";
import { buildPayrollEntry } from "../src/lib/payroll.js";
import { buildPrepaidCapitalizeEntry, buildPrepaidAmortizeEntry } from "../src/lib/prepaid.js";
import { buildAccruedLiabilityEntry } from "../src/lib/accruedLiabilities.js";
import { fiscalYearStart, fiscalYearSplit, computeNetIncome } from "../src/lib/reports.js";
import { buildBankLineEntry } from "../src/lib/bankMatch.js";
import fs from "fs";
import path from "path";

// ════════════════════════════════════════════════════════════════════════════
// GAAP INVARIANT GUARDRAIL — the standing CI spec for every economic event.
// For each event we assert, over its journal entry (expressed as GL lines):
//   (a) the entry balances (debits = credits)
//   (b) the accounting equation holds: Assets = Liabilities + Equity + NetIncome
//   (c) payments / collections / opening balances / a booking+its reversal leave
//       net income unchanged (balance-sheet-only movements)
//   (d) ONLY revenue (4xxx) and expense (5xxx–8xxx) accounts move net income
// Events that already have a pure builder (payments/collections) are routed
// THROUGH it (validating real code); the rest carry the CORRECT GAAP entry as the
// spec — as each builder is extracted (remediation), wire it in here in place of
// the literal lines and this guardrail proves the builder still obeys GAAP.
// ════════════════════════════════════════════════════════════════════════════

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const d0 = String;                                  // first-digit classifier
const firstDigit = c => d0(c || "")[0];
const isAsset   = c => firstDigit(c) === "1";
const isLiab    = c => firstDigit(c) === "2";
const isEquity  = c => firstDigit(c) === "3";
const isRevenue = c => firstDigit(c) === "4";
const isExpense = c => ["5", "6", "7", "8"].includes(firstDigit(c));

const sum = (lines, f) => r2(lines.reduce((s, l) => s + f(l), 0));
const debits  = lines => sum(lines, l => Number(l.debit) || 0);
const credits = lines => sum(lines, l => Number(l.credit) || 0);
const dc = l => (Number(l.debit) || 0) - (Number(l.credit) || 0);   // debit-positive

const assetsDelta  = lines => sum(lines.filter(l => isAsset(l.code)),   dc);
const liabDelta    = lines => sum(lines.filter(l => isLiab(l.code)),   l => -dc(l));
const equityDelta  = lines => sum(lines.filter(l => isEquity(l.code)), l => -dc(l));
const revenueDelta = lines => sum(lines.filter(l => isRevenue(l.code)), l => -dc(l));
const expenseDelta = lines => sum(lines.filter(l => isExpense(l.code)), dc);
const netIncome    = lines => r2(revenueDelta(lines) - expenseDelta(lines));
const hasPLLine    = lines => lines.some(l => isRevenue(l.code) || isExpense(l.code));
// Assets = Liabilities + Equity + NetIncome  ⇒  residual must be 0 for any balanced entry.
const equationResidual = lines => r2(assetsDelta(lines) - (liabDelta(lines) + equityDelta(lines) + netIncome(lines)));

// Default-COA codes. 3400 = Opening Balance Equity (remediation #6 will seed it; the
// invariant classifies by first digit, so the test is valid before it's seeded).
const C = {
  cash: "1000", ar: "1100", prepaid: "1300", rou: "1800", accumDep: "1510",
  ap: "2000", accrued: "2100", deferredRev: "2300", salesTax: "2350",
  leaseCurr: "2400", leaseLT: "2450", obe: "3400", payrollTaxesPayable: "2101",
  revenue: "4000", subRev: "4200", wages: "6000", payrollTax: "6010",
  depExp: "6900", expense: "6500",
};

// Real-code lines for the payment & collection events.
const payAPLines = paymentEntryLines(buildPaymentEntry(
  { secondary_gl_code: C.ap, amount: 100, vendor: "AWS" }, "ap",
  { apCode: C.ap, accruedCode: C.accrued, arCode: C.ar, cashCode: C.cash, cashName: "Cash", date: "2026-06-19", billDbId: "b1" }
));
const collectARLines = paymentEntryLines(buildPaymentEntry(
  { secondary_gl_code: C.ar, amount: 400, vendor: "ClientCo" }, "ar",
  { apCode: C.ap, accruedCode: C.accrued, arCode: C.ar, cashCode: C.cash, cashName: "Cash", date: "2026-06-19", billDbId: "i1" }
));

// economic event → correct journal entry (lines) + whether it should move net income.
const EVENTS = [
  { name: "1 · book vendor bill (accrual)",          lines: [{ code: C.expense, debit: 100, credit: 0 }, { code: C.ap, debit: 0, credit: 100 }], movesNI: true },
  { name: "1b · book bill direct-to-cash",           lines: [{ code: C.expense, debit: 100, credit: 0 }, { code: C.cash, debit: 0, credit: 100 }], movesNI: true },
  { name: "2 · pay a bill (real builder)",           lines: payAPLines, movesNI: false },
  { name: "4 · issue customer invoice",              lines: [{ code: C.ar, debit: 500, credit: 0 }, { code: C.revenue, debit: 0, credit: 500 }], movesNI: true },
  { name: "5 · collect an invoice (real builder)",   lines: collectARLines, movesNI: false },
  { name: "6 · opening balances (real builder, plug to OBE)", lines: buildOpeningBalanceEntry({ [C.cash]: 5000, [C.rou]: 3000, [C.ap]: 2000 }, { cutoffDate: "2026-01-01", obeCode: C.obe }).lines, movesNI: false },
  { name: "7 · bank/cash opening position (real builder)",    lines: buildOpeningBalanceEntry({ [C.cash]: 5000 }, { cutoffDate: "2026-01-01", obeCode: C.obe }).lines, movesNI: false },
  { name: "8 · depreciation (real builder)",         lines: buildDepreciationEntry({ amount: 200, depExpCode: C.depExp, accumDepCode: C.accumDep }).lines, movesNI: true },
  { name: "9 · prepaid — capitalize (real builder)", lines: buildPrepaidCapitalizeEntry({ amount: 1200, prepaidCode: C.prepaid, offsetCode: C.ap }).lines, movesNI: false },
  { name: "9b · prepaid — amortization (real builder)", lines: buildPrepaidAmortizeEntry({ amount: 100, expenseCode: C.expense, prepaidCode: C.prepaid }).lines, movesNI: true },
  { name: "10 · accrued liability recognition (real builder)", lines: buildAccruedLiabilityEntry({ amount: 800, expenseCode: C.wages, accruedCode: C.accrued }).lines, movesNI: true },
  { name: "11 · deferred revenue — receipt (real builder)", lines: buildDeferredRevenueReceiptEntry({ amount: 1200, cashCode: C.cash, deferredRevCode: C.deferredRev }).lines, movesNI: false },
  { name: "11b · deferred revenue — recognition",    lines: [{ code: C.deferredRev, debit: 100, credit: 0 }, { code: C.subRev, debit: 0, credit: 100 }], movesNI: true },
  { name: "12 · lease commencement (ASC 842)",       lines: [{ code: C.rou, debit: 10000, credit: 0 }, { code: C.leaseCurr, debit: 0, credit: 4000 }, { code: C.leaseLT, debit: 0, credit: 6000 }], movesNI: false },
  { name: "13 · payroll (real builder, net→cash, payroll taxes payable)", lines: buildPayrollEntry({ gross: 1000, netPay: 800, employerTaxes: 76.5, salariesCode: C.wages, payrollTaxExpCode: C.payrollTax, cashCode: C.cash, payrollTaxesPayableCode: C.payrollTaxesPayable }).lines, movesNI: true },
  { name: "16 · sales tax on AR invoice (real builder)", lines: buildArInvoiceEntry({ subtotal: 100, taxRate: 0.07, arCode: C.ar, revenueCode: C.revenue, salesTaxCode: C.salesTax }).lines, movesNI: true },
  // ── 3 · A BANK STATEMENT LINE (real builder) ─────────────────────────────────
  // ★★★ THE HIGHEST-VOLUME BOOKING PATH IN THE PRODUCT WAS NOT IN THIS GUARDRAIL. Statements
  // are the main way transactions enter the books — every drive to date has been
  // statement-shaped — and `buildBankLineEntry` was tested for its SHAPE in five files while
  // no test ever ran it through Dr=Cr, the accounting equation, or the net-income rules.
  // A builder that produces most of the ledger belongs in the file that checks the ledger.
  // ── 17 · YEAR-END CLOSE (real builder) ──────────────────────────────────────
  // ★ THE LAST OF THE SEVENTEEN TO GET A BUILDER. It has NO CALLER by design — the product
  // does a DERIVED soft close, and whether to also POST closing entries is an accounting
  // decision about locking a year, not a mechanism gap. §12's rule is that every event has a
  // pure builder with a test asserting exact Dr/Cr, so the decision can be made without also
  // being a build.
  //
  // ★★ `movesNI: true` IS CORRECT AND READS ODDLY, so it is worth stating: the close ZEROES
  // the P&L, so its own effect on net income is the whole year's net, inverted. It is the one
  // entry whose purpose is to move net income to zero.
  { name: "17 · year-end close (real builder)", lines: buildYearEndCloseEntry({
      retainedEarningsCode: "3100",
      balances: [{ code: C.revenue, balance: 10000 }, { code: C.expense, balance: 4000 }],
    }).lines, movesNI: true },
  ...[
    { n: "3 · bank line — money out (expense)", txn: { amount: 120, type: "expense", gl_code: C.expense, gl_name: "Software", date: "2026-06-19", vendor: "Vendor" } },
    { n: "3b · bank line — money in (revenue)", txn: { amount: 900, type: "revenue", gl_code: C.revenue, gl_name: "Sales", date: "2026-06-19", vendor: "Customer" } },
  ].map(({ n, txn }) => {
    const e = buildBankLineEntry(txn, { offsetCode: C.cash, offsetName: "Cash" });
    // The builder returns a FLATTENED row (primary + offset), which is what
    // `persistJournalEntry` posts as two lines. Expanded here the same way the write path
    // does, so the invariants run on what actually reaches the books.
    const lines = e.debit_credit === "credit"
      ? [{ code: e.secondary_gl_code, debit: e.amount, credit: 0 }, { code: e.gl_code, debit: 0, credit: e.amount }]
      : [{ code: e.gl_code, debit: e.amount, credit: 0 }, { code: e.secondary_gl_code, debit: 0, credit: e.amount }];
    return { name: n, lines, movesNI: true };
  }),
];

describe("(a) every economic event's entry balances (debits = credits)", () => {
  for (const e of EVENTS) {
    it(e.name, () => { expect(debits(e.lines)).toBe(credits(e.lines)); });
  }
  it("sanity: the balance check actually catches an unbalanced entry", () => {
    const bad = [{ code: C.expense, debit: 100, credit: 0 }, { code: C.ap, debit: 0, credit: 90 }];
    expect(debits(bad)).not.toBe(credits(bad));
  });
});

describe("(b) accounting equation holds: Assets = Liabilities + Equity + NetIncome", () => {
  for (const e of EVENTS) {
    it(e.name, () => { expect(equationResidual(e.lines)).toBe(0); });
  }
  it("holds for the cumulative ledger (all events posted together)", () => {
    const all = EVENTS.flatMap(e => e.lines);
    expect(debits(all)).toBe(credits(all));
    expect(equationResidual(all)).toBe(0);
  });
});

describe("(c) balance-sheet-only movements leave net income unchanged", () => {
  const byName = n => EVENTS.find(e => e.name.startsWith(n)).lines;
  it("paying a bill → net income 0", () => expect(netIncome(byName("2 ·"))).toBe(0));
  it("collecting an invoice → net income 0", () => expect(netIncome(byName("5 ·"))).toBe(0));
  it("opening balances → net income 0", () => expect(netIncome(byName("6 ·"))).toBe(0));
  it("bank opening position → net income 0", () => expect(netIncome(byName("7 ·"))).toBe(0));
  it("a booking and its reversal (real builder) together → net income 0", () => {
    const booking = byName("1 ·");
    const reversal = reverseEntryLines(booking);     // the live reversal builder
    expect(netIncome(booking)).toBe(-100);           // the booking alone hits P&L
    expect(netIncome([...booking, ...reversal])).toBe(0);   // together they cancel
    expect(equationResidual([...booking, ...reversal])).toBe(0);
    // nets to zero on every account
    const net = {};
    [...booking, ...reversal].forEach(l => { net[l.code] = (net[l.code] || 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0); });
    expect(Object.values(net).every(v => r2(v) === 0)).toBe(true);
  });
});

// ── Fiscal-year Retained-Earnings split (derived soft close, Issue 2) ────────
describe("fiscal-year RE split — prior years roll into beginning RE, don't leak into current", () => {
  // Helper to build a flattened P&L entry (live, posted).
  const e = (id, date, code, amount) => ({ id, date, gl_code: code, amount, type: isRevenue(code) ? "revenue" : "expense", status: "booked" });
  // Two fiscal years (FYE 12-31), cutoff 2025-01-01, asOf mid-2026.
  //   Prior FY 2025: rev 1000 − exp 600 = +400 (closed → beginning RE)
  //   Current FY 2026 (through asOf): rev 500 − exp 800 = −300 (current period)
  const FIX2Y = [
    e("p1", "2025-03-01", "4000", 1000), e("p2", "2025-05-01", "6500", 600),
    e("c1", "2026-02-01", "4000", 500),  e("c2", "2026-04-01", "6500", 800),
  ];
  const split = fiscalYearSplit(FIX2Y, { asOf: "2026-06-30", fiscalYearEnd: "12-31", cutoffDate: "2025-01-01" });

  it("fiscalYearStart respects the fiscal-year end (and a mid-year FYE)", () => {
    expect(fiscalYearStart("2026-06-30", "12-31")).toBe("2026-01-01");
    expect(fiscalYearStart("2026-03-15", "06-30")).toBe("2025-07-01");
    expect(fiscalYearStart("2026-08-15", "06-30")).toBe("2026-07-01");
  });
  it("prior fiscal years' net rolls into beginning RE", () => { expect(split.priorNet).toBe(400); });
  it("current-period net is THIS fiscal year only (the 2024/prior loss does not leak in)", () => { expect(split.currentNet).toBe(-300); });
  it("priorClosed + current === all-time net (no double-count, no leak)", () => {
    expect(split.priorNet + split.currentNet).toBe(100);
    expect(split.priorNet + split.currentNet).toBe(computeNetIncome(FIX2Y, { to: "2026-06-30" }));
  });
  it("the year-boundary case: a prior-year-dated loss shows in beginning RE, not current period", () => {
    // A single 2024 loss with asOf in 2026 → all of it is prior, none current (the reported bug).
    const s = fiscalYearSplit([e("x", "2024-09-01", "6500", 217.74)], { asOf: "2026-06-17", fiscalYearEnd: "12-31", cutoffDate: null });
    expect(s.priorNet).toBe(-217.74);
    expect(s.currentNet).toBe(0);
  });
  it("the cutoff floors the fiscal-year start", () => {
    const s = fiscalYearSplit(FIX2Y, { asOf: "2026-06-30", fiscalYearEnd: "12-31", cutoffDate: "2026-03-01" });
    expect(s.fyStart).toBe("2026-03-01");
  });
});

describe("(d) only revenue (4xxx) and expense (5xxx–8xxx) accounts move net income", () => {
  for (const e of EVENTS) {
    it(`${e.name} — moves NI iff it has a P&L line`, () => {
      expect(netIncome(e.lines) !== 0).toBe(e.movesNI);
      expect(netIncome(e.lines) !== 0).toBe(hasPLLine(e.lines));
    });
  }
  it("net income is computed purely from 4xxx/5–8xxx lines (balance-sheet lines never contribute)", () => {
    // Stripping all P&L lines from any event must zero its net income.
    for (const e of EVENTS) {
      const bsOnly = e.lines.filter(l => !isRevenue(l.code) && !isExpense(l.code));
      expect(netIncome(bsOnly)).toBe(0);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ★★ WHICH WAY THE MONEY WENT MUST COME FROM THE STATEMENT, NOT FROM A FLAG.
//
// `buildBankLineEntry` decides debit-or-credit from `txn.type === "revenue"`, and §9 spends
// a page on why deriving truth from a denormalized status flag is the root cause of the O73
// bank-matching class: a `type` string that drifts starves the matcher and flips behaviour.
//
// ★ TODAY IT IS SAFE, AND ONLY BY VIRTUE OF SOMETHING UPSTREAM: `bank_statement_lines` has a
// `direction` column ('in'/'out') and NO `type` column, so the pipeline's
// `l.type || (l.direction === "in" ? "revenue" : "expense")` always falls through to the
// statement's own answer. **A guard that is correct because of a schema nobody is thinking
// about is a guard nobody has tested** — the same shape as the reversal check that worked
// only because a query upstream filtered deleted rows.
//
// So: pin that the direction the books get is the direction the STATEMENT reported. If a
// `type` column ever appears on those lines, or a caller starts passing one, this fails
// rather than silently booking money the wrong way round.
// ═════════════════════════════════════════════════════════════════════════════
describe("★★ a bank line's direction follows the statement", () => {
  const line = (direction) => ({ date: "2026-06-19", amount: 250, direction, description: "ACH", vendor: "V" });
  // The pipeline's own derivation, quoted from App.jsx so the two cannot drift apart.
  const typeFromLine = (l) => l.type || (l.direction === "in" ? "revenue" : "expense");

  it("★★★ money IN becomes revenue, money OUT becomes an expense", () => {
    expect(typeFromLine(line("in"))).toBe("revenue");
    expect(typeFromLine(line("out"))).toBe("expense");
  });

  it("★★★ and the entry moves cash the way the statement says", () => {
    const inEntry = buildBankLineEntry({ ...line("in"), type: typeFromLine(line("in")), gl_code: C.revenue }, { offsetCode: C.cash, offsetName: "Cash" });
    const outEntry = buildBankLineEntry({ ...line("out"), type: typeFromLine(line("out")), gl_code: C.expense }, { offsetCode: C.cash, offsetName: "Cash" });
    // Money in: cash is DEBITED (the primary leg is a credit to revenue).
    expect(inEntry.debit_credit).toBe("credit");
    // Money out: the expense is DEBITED and cash credited.
    expect(outEntry.debit_credit).toBe("debit");
  });

  it("★★ the statement's own column is the only source — there is no `type` to override it", () => {
    // `bank_statement_lines` has `direction` and no `type`. If that ever changes, the
    // pipeline's `l.type ||` would take precedence over the statement and could book money
    // backwards; this is the tripwire for that day.
    const mig = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/058_bank_statements.sql"), "utf8");
    const table = mig.slice(mig.indexOf("bank_statement_lines"), mig.indexOf(");", mig.indexOf("bank_statement_lines")));
    expect(table).toMatch(/direction\s+text\s+check \(direction in \('in','out'\)\)/);
    expect(table).not.toMatch(/^\s*type\s+text/m);
  });

  it("★ a line with no direction at all is treated as money out, not as revenue", () => {
    // The conservative default: booking an unknown line as an expense understates income and
    // shows up in review. Booking it as revenue inflates income and looks like good news,
    // which is the direction nobody checks.
    expect(typeFromLine({ date: "2026-06-19", amount: 250 })).toBe("expense");
  });
});
