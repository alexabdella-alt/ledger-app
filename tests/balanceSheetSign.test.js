import { describe, it, expect } from "vitest";
import { fmtSignedMoney } from "../src/lib/format.js";
import { glAccountBalance } from "../src/lib/reports.js";

// Shadow-test-co shakedown #4: a negative cash position (overdraft) was rendered on the
// Balance Sheet as a POSITIVE magnitude (786.50 instead of -786.50), masking the
// overdraft and overstating assets. The ledger is correct; the BS formatter dropped the
// sign. These lock the engine->formatter chain the Balance Sheet renders.

describe("fmtSignedMoney — negative balances render with their sign (never magnitude-only)", () => {
  it("a negative (overdrawn) balance keeps its sign", () => {
    expect(fmtSignedMoney(-786.5)).toBe("-$786.50");
  });
  it("a positive balance has no sign", () => {
    expect(fmtSignedMoney(786.5)).toBe("$786.50");
    expect(fmtSignedMoney(1234.5)).toBe("$1,234.50");
  });
  it("zero is $0.00 (no sign)", () => {
    expect(fmtSignedMoney(0)).toBe("$0.00");
    expect(fmtSignedMoney(null)).toBe("$0.00");
  });
});

describe("Balance Sheet cash sign (engine -> formatter) — overdraft shows as negative", () => {
  // A fresh company, no opening balance: revenue collected to cash, more expenses paid
  // from cash -> cash goes negative (the shakedown's -786.50 overdraft).
  const e = (o) => ({ id: o.id, vendor: o.vendor, amount: o.amount, date: o.date,
    gl_code: o.gl_code, gl_name: o.gl_code, debit_credit: o.debit_credit,
    secondary_gl_code: o.secondary_gl_code, status: "booked" });
  const ledger = [
    e({ id: "rev", vendor: "Acme",  amount: 8984,    date: "2026-02-05", gl_code: "4000", debit_credit: "credit", secondary_gl_code: "1000" }), // Dr Cash / Cr Revenue
    e({ id: "exp", vendor: "Costs", amount: 9770.5,  date: "2026-02-20", gl_code: "6500", debit_credit: "debit",  secondary_gl_code: "1000" }), // Dr Expense / Cr Cash
  ];

  it("glAccountBalance(cash) is negative (the real overdraft, debit-normal asset)", () => {
    const cash = glAccountBalance("1000", ledger, { asOf: "2026-02-28" });
    expect(cash).toBeCloseTo(-786.5, 2);            // 8984 in - 9770.50 out
  });

  it("the Balance Sheet renders that cash as NEGATIVE, not a positive magnitude", () => {
    const cash = glAccountBalance("1000", ledger, { asOf: "2026-02-28" });
    const rendered = fmtSignedMoney(cash);          // bsFmt === fmtSignedMoney
    expect(rendered).toBe("-$786.50");
    expect(rendered.startsWith("-")).toBe(true);    // never flipped to positive
  });
});
