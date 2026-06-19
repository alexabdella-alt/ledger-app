import { describe, it, expect } from "vitest";
import {
  paymentNeedsGLMovement, buildPaymentEntry, paymentEntryLines, glBalanceEffect, PAYMENT_KINDS,
} from "../src/lib/payments.js";

// Account codes (default COA roles)
const CODES = { apCode: "2000", accruedCode: "2100", arCode: "1100", cashCode: "1000", cashName: "Cash & Cash Equivalents" };
const OPTS = (over = {}) => ({ ...CODES, date: "2026-06-18", billDbId: "bill-1", ...over });

const sumDebit  = lines => lines.reduce((s, l) => s + l.debit, 0);
const sumCredit = lines => lines.reduce((s, l) => s + l.credit, 0);

describe("paymentNeedsGLMovement — only post when booked to a liability/receivable", () => {
  it("AP bill booked to Accounts Payable needs a movement", () => {
    expect(paymentNeedsGLMovement({ secondary_gl_code: "2000" }, "ap", CODES)).toBe(true);
  });
  it("AP bill booked to Accrued Liabilities needs a movement", () => {
    expect(paymentNeedsGLMovement({ secondary_gl_code: "2100" }, "ap", CODES)).toBe(true);
  });
  it("AP bill booked DIRECT-TO-CASH needs NO movement (already settled; never double-credit cash)", () => {
    expect(paymentNeedsGLMovement({ secondary_gl_code: "1000" }, "ap", CODES)).toBe(false);
  });
  it("entry with no offset needs no movement", () => {
    expect(paymentNeedsGLMovement({ secondary_gl_code: null }, "ap", CODES)).toBe(false);
  });
  it("AR invoice booked to Accounts Receivable needs a movement; cash-sale does not", () => {
    expect(paymentNeedsGLMovement({ secondary_gl_code: "1100" }, "ar", CODES)).toBe(true);
    expect(paymentNeedsGLMovement({ secondary_gl_code: "1000" }, "ar", CODES)).toBe(false);
  });
});

describe("buildPaymentEntry — balanced AP payment (Dr AP / Cr Cash)", () => {
  const bill = { secondary_gl_code: "2000", secondary_gl_name: "Accounts Payable", amount: 250, vendor: "AWS" };
  const entry = buildPaymentEntry(bill, "ap", OPTS());

  it("debits the AP liability and credits Cash", () => {
    expect(entry.gl_code).toBe("2000");            // primary, debited
    expect(entry.debit_credit).toBe("debit");
    expect(entry.secondary_gl_code).toBe("1000");  // cash, credited
    expect(entry.amount).toBe(250);
  });
  it("expands to two balanced lines", () => {
    const lines = paymentEntryLines(entry);
    expect(lines).toEqual([
      { code: "2000", debit: 250, credit: 0 },
      { code: "1000", debit: 0, credit: 250 },
    ]);
    expect(sumDebit(lines)).toBe(sumCredit(lines));   // books stay balanced
  });
  it("links back to the originating bill for reversal", () => {
    expect(entry._paymentKind).toBe(PAYMENT_KINDS.ap);
    expect(entry._paymentForId).toBe("bill-1");
  });
});

describe("buildPaymentEntry — Accrued offset and AR collection", () => {
  it("AP bill booked to Accrued debits Accrued (not 2000)", () => {
    const e = buildPaymentEntry({ secondary_gl_code: "2100", amount: 90, vendor: "X" }, "ap", OPTS());
    expect(e.gl_code).toBe("2100");
    expect(paymentEntryLines(e)).toEqual([
      { code: "2100", debit: 90, credit: 0 },
      { code: "1000", debit: 0, credit: 90 },
    ]);
  });
  it("AR collected debits Cash and credits AR", () => {
    const e = buildPaymentEntry({ secondary_gl_code: "1100", amount: 400, vendor: "ClientCo" }, "ar", OPTS());
    expect(e.gl_code).toBe("1000");            // cash, debited
    expect(e.secondary_gl_code).toBe("1100");  // AR, credited
    expect(e._paymentKind).toBe(PAYMENT_KINDS.ar);
    expect(paymentEntryLines(e)).toEqual([
      { code: "1000", debit: 400, credit: 0 },
      { code: "1100", debit: 0, credit: 400 },
    ]);
  });
});

describe("buildPaymentEntry — no entry cases", () => {
  it("direct-to-cash bill posts NO entry", () => {
    expect(buildPaymentEntry({ secondary_gl_code: "1000", amount: 100, vendor: "X" }, "ap", OPTS())).toBeNull();
  });
  it("zero / missing amount posts no entry", () => {
    expect(buildPaymentEntry({ secondary_gl_code: "2000", amount: 0, vendor: "X" }, "ap", OPTS())).toBeNull();
    expect(buildPaymentEntry({ secondary_gl_code: "2000", vendor: "X" }, "ap", OPTS())).toBeNull();
  });
  it("missing cash account posts no entry (avoids a malformed Dr AP / Cr AP)", () => {
    expect(buildPaymentEntry({ secondary_gl_code: "2000", amount: 100, vendor: "X" }, "ap", OPTS({ cashCode: undefined }))).toBeNull();
  });
});

describe("paying actually REDUCES the GL Accounts Payable balance", () => {
  // Bill booked: Dr Expense 100 / Cr AP 100  → AP balance +100 (credit-normal liability)
  const bookingLines = [{ code: "6500", debit: 100, credit: 0 }, { code: "2000", debit: 0, credit: 100 }];
  const payEntry = buildPaymentEntry({ secondary_gl_code: "2000", amount: 100, vendor: "AWS" }, "ap", OPTS());
  const payLines = paymentEntryLines(payEntry);

  it("AP is 100 after booking, 0 after the payment posts", () => {
    expect(glBalanceEffect(bookingLines, "2000", { normal: "credit" })).toBe(100);
    expect(glBalanceEffect([...bookingLines, ...payLines], "2000", { normal: "credit" })).toBe(0);
  });
  it("the payment reduces Cash by the amount", () => {
    expect(glBalanceEffect(payLines, "1000", { normal: "debit" })).toBe(-100);
  });
  it("REVERSAL: excluding the payment entry restores AP to 100 (un-pay/void)", () => {
    // Reversal = soft-deleting the payment JE, i.e. it stops counting in the GL.
    expect(glBalanceEffect([...bookingLines], "2000", { normal: "credit" })).toBe(100);
  });
});
