import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildPaymentEntry } from "../src/lib/payments";

// C605 — review finding K2: clearings and "Accept & add" posted to main Cash whatever the
// statement's account was.
const app = readFileSync("src/App.jsx", "utf8");
const mbp = app.slice(app.indexOf("const markBillPaidOnce = async"), app.indexOf("const payEntry = buildPaymentEntry(") + 400);

describe("a payment moves the account it actually went through", () => {
  it("★ 'mark paid' takes the account, and defaults to Cash only when none is given", () => {
    expect(mbp).toMatch(/side = "ap", cashCode = null, cashName = null, amount = null \} = \{\}\) => \{/);   // C718 — and how much
    expect(mbp).toMatch(/cashCode: cashCode \|\| rc\("cash"\), cashName: cashCode \? \(cashName \|\| cashCode\) : rn\("cash"\),/);
  });

  it("★ the payment entry credits the account it is given (a card, not Cash)", () => {
    const bill = { id: "b1", db_entry_id: "b1", amount: 120, gl_code: "6250", secondary_gl_code: "2000", debit_credit: "debit", payment_status: "unpaid" };
    const e = buildPaymentEntry(bill, "ap", { apCode: "2000", arCode: "1100", cashCode: "2100", cashName: "Credit Card", date: "2026-03-01", billDbId: "b1" });
    expect(e).toBeTruthy();
    expect(JSON.stringify(e)).toMatch(/2100/);
    expect(JSON.stringify(e)).not.toMatch(/"1000"/);
  });

  it("★ every statement caller passes the statement's account", () => {
    expect(app.match(/markBillPaid\(c\.invoiceId, \{ side: c\.side, method: "bank_transfer", paidDate: c\.date \|\| null, amount: c\.entry\?\.amount \?\? null, cashCode: offsetCode, cashName: offsetName \}\)/g)).toHaveLength(2);   // C718 — the amount the clearing was built for
    expect(app).toMatch(/paidDate: bank_txn\?\.date \|\| null, cashCode: matchRecord\.importOffsetCode \|\| null, cashName: matchRecord\.importOffsetName \|\| null,\s*\.\.\.\(partialPay \? \{ amount: amountProblem\.bank \} : \{\}\) \}\)/);
  });

  it("★ Reconcile's 'Accept & add' books against the account being reconciled", () => {
    const v = readFileSync("src/components/views/ReconView.jsx", "utf8");
    const fn = v.slice(v.indexOf("const addToBooks = async"), v.indexOf("const completeMatch = async"));
    expect(fn).toMatch(/const recAcct = \(bankAccounts\|\|\[\]\)\.find\(b => String\(b\.id\)===String\(accountId\)\);\s*\n\s*const offCode = recAcct\?\.gl_code \|\| getAccountByRole\("cash"\)\?\.code;/);
    expect(fn).toMatch(/secondary_gl_code: offCode, secondary_gl_name: offName,/);
    expect(fn).not.toMatch(/secondary_gl_code:getAccountByRole\("cash"\)/);
  });
});
