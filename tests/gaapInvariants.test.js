import { describe, it, expect } from "vitest";
import { buildPaymentEntry, paymentEntryLines } from "../src/lib/payments.js";
import { reverseEntryLines } from "../src/lib/journalEntries.js";

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
  leaseCurr: "2400", leaseLT: "2450", obe: "3400",
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
  { name: "6 · opening balances (plug to OBE)",      lines: [{ code: C.cash, debit: 5000, credit: 0 }, { code: C.rou, debit: 3000, credit: 0 }, { code: C.ap, debit: 0, credit: 2000 }, { code: C.obe, debit: 0, credit: 6000 }], movesNI: false },
  { name: "7 · bank/cash opening position",          lines: [{ code: C.cash, debit: 5000, credit: 0 }, { code: C.obe, debit: 0, credit: 5000 }], movesNI: false },
  { name: "8 · depreciation",                        lines: [{ code: C.depExp, debit: 200, credit: 0 }, { code: C.accumDep, debit: 0, credit: 200 }], movesNI: true },
  { name: "9 · prepaid — capitalize",                lines: [{ code: C.prepaid, debit: 1200, credit: 0 }, { code: C.ap, debit: 0, credit: 1200 }], movesNI: false },
  { name: "9b · prepaid — monthly amortization",     lines: [{ code: C.expense, debit: 100, credit: 0 }, { code: C.prepaid, debit: 0, credit: 100 }], movesNI: true },
  { name: "10 · accrued liability recognition",      lines: [{ code: C.wages, debit: 800, credit: 0 }, { code: C.accrued, debit: 0, credit: 800 }], movesNI: true },
  { name: "11 · deferred revenue — receipt",         lines: [{ code: C.cash, debit: 1200, credit: 0 }, { code: C.deferredRev, debit: 0, credit: 1200 }], movesNI: false },
  { name: "11b · deferred revenue — recognition",    lines: [{ code: C.deferredRev, debit: 100, credit: 0 }, { code: C.subRev, debit: 0, credit: 100 }], movesNI: true },
  { name: "12 · lease commencement (ASC 842)",       lines: [{ code: C.rou, debit: 10000, credit: 0 }, { code: C.leaseCurr, debit: 0, credit: 4000 }, { code: C.leaseLT, debit: 0, credit: 6000 }], movesNI: false },
  { name: "13 · payroll (net to cash, taxes payable)", lines: [{ code: C.wages, debit: 1000, credit: 0 }, { code: C.payrollTax, debit: 76.5, credit: 0 }, { code: C.cash, debit: 0, credit: 800 }, { code: C.accrued, debit: 0, credit: 276.5 }], movesNI: true },
  { name: "16 · sales tax collected (cash sale)",    lines: [{ code: C.cash, debit: 107, credit: 0 }, { code: C.revenue, debit: 0, credit: 100 }, { code: C.salesTax, debit: 0, credit: 7 }], movesNI: true },
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
