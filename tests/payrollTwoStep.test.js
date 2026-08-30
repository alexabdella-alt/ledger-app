import { describe, it, expect } from "vitest";
import { buildPayrollEntry, buildPayrollAccrualEntry, buildPayrollDisbursementEntry } from "../src/lib/payroll";

// ═════════════════════════════════════════════════════════════════════════════
// ACCRUE-THEN-PAY — §12's deferred payroll variant.
//
// The built case posts one entry and credits Cash for net pay: it ASSUMES the money has
// already gone out, which is true when the register and the payment land together. It is
// wrong whenever the pay period ENDS in one month and the money leaves in the next — the
// expense belongs to the period worked, the cash to the day it moved.
//
// ★★★ THE INVARIANT THAT MAKES THIS SAFE, AND THE ONLY ONE WORTH TESTING HARD: **the two
// entries together must be exactly the one-step entry.** If accrue-then-pay produced a
// different net effect, a company would get a different P&L for choosing a different
// bookkeeping convention on identical facts — which is not a variant, it is a bug with a
// preference setting.
// ═════════════════════════════════════════════════════════════════════════════

const C = { salaries: "6000", tax: "6010", cash: "1000", payable: "2101", liability: "2100" };
const RUN = { gross: 4000, employerTaxes: 306, netPay: 3150 };
const codes = { salariesCode: C.salaries, payrollTaxExpCode: C.tax, cashCode: C.cash, payrollTaxesPayableCode: C.payable };

const netByAccount = (lines) => {
  const o = {};
  for (const l of lines) o[l.code] = Math.round(((o[l.code] || 0) + (l.debit || 0) - (l.credit || 0)) * 100) / 100;
  return o;
};

describe("★★★ the two steps together ARE the one step", () => {
  const one = buildPayrollEntry({ ...RUN, ...codes });
  const accrual = buildPayrollAccrualEntry({ ...RUN, ...codes, payrollLiabilityCode: C.liability });
  const paid = buildPayrollDisbursementEntry({ netPay: RUN.netPay, payrollLiabilityCode: C.liability, cashCode: C.cash });

  it("both routes exist and balance", () => {
    for (const e of [one, accrual, paid]) {
      expect(e).toBeTruthy();
      expect(e.balanced).toBe(true);
    }
  });

  it("★★★ identical net effect on every account", () => {
    const combined = netByAccount([...accrual.lines, ...paid.lines]);
    // the liability nets to zero — it existed only between the two entries
    expect(combined[C.liability]).toBe(0);
    delete combined[C.liability];
    expect(combined).toEqual(netByAccount(one.lines));
  });

  it("★★ and identical effect on profit — the same expense, once", () => {
    const pl = (lines) => Math.round(lines.filter((l) => l.code[0] === "6").reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0) * 100) / 100;
    expect(pl([...accrual.lines, ...paid.lines])).toBe(pl(one.lines));
    expect(pl(one.lines)).toBe(4306);   // gross + employer tax
  });
});

describe("★★★ and they agree on AWKWARD numbers, which is where two paths drift", () => {
  // ★ THE ROUND-NUMBER FIXTURE ABOVE CANNOT SHOW A ROUNDING BUG. A mutation flooring the
  // accrual's net pay left every assertion green, because 3150 is already whole. Rounding is
  // precisely where two independent code paths diverge, so the invariant is re-asserted on
  // figures that do not divide evenly.
  const AWKWARD = [
    { gross: 4133.33, employerTaxes: 316.21, netPay: 3211.07 },
    { gross: 1000.01, employerTaxes: 76.51, netPay: 799.99 },
    { gross: 7777.77, employerTaxes: 0, netPay: 6111.11 },
    { gross: 0.03, employerTaxes: 0.01, netPay: 0.02 },        // the smallest run that still splits
  ];
  for (const run of AWKWARD) {
    it(`gross ${run.gross} · employer ${run.employerTaxes} · net ${run.netPay}`, () => {
      const one = buildPayrollEntry({ ...run, ...codes });
      const accrual = buildPayrollAccrualEntry({ ...run, ...codes, payrollLiabilityCode: C.liability });
      const paid = buildPayrollDisbursementEntry({ netPay: run.netPay, payrollLiabilityCode: C.liability, cashCode: C.cash });
      expect(one && accrual && paid).toBeTruthy();
      const combined = netByAccount([...accrual.lines, ...paid.lines]);
      expect(combined[C.liability]).toBe(0);          // the liability must close exactly
      delete combined[C.liability];
      expect(combined).toEqual(netByAccount(one.lines));
    });
  }
});

describe("★★ the disbursement must not touch profit", () => {
  const paid = buildPayrollDisbursementEntry({ netPay: 3150, payrollLiabilityCode: C.liability, cashCode: C.cash });

  it("★★★ no expense or revenue account appears in it", () => {
    // If it could move net income the expense would land TWICE — once when accrued and once
    // when paid — and the P&L would be wrong by a full payroll in the month the money left.
    for (const l of paid.lines) expect([l.code, ["4", "5", "6", "7", "8"].includes(l.code[0])]).toEqual([l.code, false]);
  });

  it("★ it is exactly two lines: the liability going away and the cash leaving", () => {
    expect(paid.lines).toHaveLength(2);
    expect(netByAccount(paid.lines)).toEqual({ [C.liability]: 3150, [C.cash]: -3150 });
  });
});

describe("★ the accrual owes the money rather than paying it", () => {
  const accrual = buildPayrollAccrualEntry({ ...RUN, ...codes, payrollLiabilityCode: C.liability });

  it("★★ cash is untouched — that is the whole difference", () => {
    expect(accrual.lines.some((l) => l.code === C.cash)).toBe(false);
    expect(netByAccount(accrual.lines)[C.liability]).toBe(-3150);   // credited: owed
  });

  it("★ withholdings and employer tax still land in payroll taxes payable", () => {
    // Neither depends on when the net pay physically left, so neither moves.
    expect(netByAccount(accrual.lines)[C.payable]).toBe(-1156);     // 850 withheld + 306 employer
  });

  it("refuses without a liability account rather than falling back to cash", () => {
    // Falling back would silently produce the one-step entry under a two-step name — the
    // caller would believe the expense and the cash had been separated when they had not.
    expect(buildPayrollAccrualEntry({ ...RUN, ...codes })).toBeNull();
  });

  it("keeps the one-step builder's guards", () => {
    expect(buildPayrollAccrualEntry({ ...RUN, ...codes, payrollLiabilityCode: C.liability, netPay: 5000 })).toBeNull();  // net > gross
    expect(buildPayrollAccrualEntry({ ...RUN, ...codes, payrollLiabilityCode: C.liability, gross: 0 })).toBeNull();
  });
});
