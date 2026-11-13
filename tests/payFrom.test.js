import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { payFromOptions, payFromByKey, paidFromCopy, OWN_MONEY } from "../src/lib/payFrom";
import { buildPaymentEntry } from "../src/lib/payments";

// C674 — "Paid from": where the money for a bill came from.
const CHART = [{ code: "1000", name: "Cash", system_role: "cash" }, { code: "3200", name: "Additional Paid-In Capital", system_role: "additional_paid_in_capital" }];
const byRole = (r) => CHART.find((a) => a.system_role === r) || null;
const banks = [{ id: "K", name: "Checking", type: "checking", gl_code: "1000" }, { id: "S", name: "Savings", type: "savings", gl_code: "1010" },
  { id: "C", name: "Amex", type: "credit_card", gl_code: "2200" }, { id: "K2", name: "Old checking", type: "checking", gl_code: "1000" }];
const bill = { id: "b1", vendor: "Adobe", amount: 59.99, gl_code: "6500", gl_name: "Software", secondary_gl_code: "2000", secondary_gl_name: "Accounts Payable", debit_credit: "debit" };

describe("the places a bill can have been paid from", () => {
  it("★ each bank account once (by its ledger account), the card, and the owner's own money last", () => {
    const o = payFromOptions({ bankAccounts: banks, getAccountByRole: byRole, chart: CHART, legalForm: "sole_prop" });
    expect(o.map((x) => [x.label, x.code])).toEqual([["Checking", "1000"], ["Savings", "1010"], ["Amex (card)", "2200"], ["My own money (personal card or cash)", "3500"]]);
    expect(o.at(-1)).toMatchObject({ key: OWN_MONEY, create: true, name: "Owner Contributions" });
  });
  it("a corporation's own money goes to Paid-In Capital", () => {
    expect(payFromOptions({ bankAccounts: banks, getAccountByRole: byRole, chart: CHART, legalForm: "s_corp" }).at(-1)).toMatchObject({ code: "3200", create: false });
  });
  it("with no bank accounts set up, the main bank account is offered", () => {
    expect(payFromOptions({ bankAccounts: [], getAccountByRole: byRole, chart: CHART })[0]).toMatchObject({ label: "Your bank account", code: "1000" });
  });
  it("an unknown or empty choice falls back to the first (the main bank)", () => {
    const o = payFromOptions({ bankAccounts: banks, getAccountByRole: byRole, chart: CHART });
    expect(payFromByKey(o, null).code).toBe("1000");
    expect(payFromByKey(o, "nope").code).toBe("1000");
  });
});

describe("★ the payment entry each choice makes", () => {
  const pay = (code, name) => buildPaymentEntry(bill, "ap", { apCode: "2000", cashCode: code, cashName: name });
  it("paid personally: Dr Bills you owe / Cr owner contributions — no bank money moves", () => {
    expect(pay("3500", "Owner Contributions")).toMatchObject({ gl_code: "2000", debit_credit: "debit", secondary_gl_code: "3500", amount: 59.99 });
  });
  it("paid with the card: the bill moves onto the card", () => {
    expect(pay("2200", "Amex")).toMatchObject({ gl_code: "2000", secondary_gl_code: "2200" });
  });
  it("the owner is told where it came from", () => {
    expect(paidFromCopy({ key: OWN_MONEY })).toBe("paid with your own money — counted as money you put into the business");
    expect(paidFromCopy({ key: "acct:C", label: "Amex (card)" })).toBe("paid from Amex (card)");
  });
});

describe("the wiring", () => {
  it("markPaid makes the owner account on first use and pays from the chosen account", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/if \(from && from\.create\) \{\s*\n\s*const made = await addCustomAccount\(\{ code: from\.code, name: from\.name, category: "Equity" \}\);/);
    expect(app).toMatch(/\.\.\.\(from \? \{ cashCode: from\.code, cashName: from\.name \} : \{\}\)/);
  });
  it.each(["src/components/TransactionDetailPanel.jsx", "src/components/views/ApView.jsx", "src/components/views/BooksView.jsx"])(
    "%s offers it and passes it", (f) => {
      const s = readFileSync(f, "utf8");
      expect(s).toMatch(/<PayFromSelect value=\{payFromKey\} onChange=\{setPayFromKey\}/);
      expect(s).toMatch(/payFrom: payFromByKey\(payFromOpts, payFromKey\)/);
    });
});
