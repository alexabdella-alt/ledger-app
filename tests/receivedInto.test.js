import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { receivedIntoOptions, receivedIntoCopy, PERSONAL } from "../src/lib/payFrom";
import { buildPaymentEntry } from "../src/lib/payments";

// C677 — a customer's payment that landed in the owner's personal account.
const CHART = [{ code: "1000", name: "Cash", system_role: "cash" }, { code: "3300", name: "Owner's Draw / Distributions", system_role: "owners_draw" }];
const byRole = (r) => CHART.find((a) => a.system_role === r) || null;
const banks = [{ id: "K", name: "Checking", type: "checking", gl_code: "1000" }, { id: "S", name: "Savings", type: "savings", gl_code: "1010" }, { id: "C", name: "Amex", type: "credit_card", gl_code: "2200" }];

describe("where a customer's payment can go", () => {
  it("★ the bank accounts (never a card), then the owner's personal account", () => {
    const o = receivedIntoOptions({ bankAccounts: banks, getAccountByRole: byRole });
    expect(o.map((x) => [x.label, x.code])).toEqual([["Checking", "1000"], ["Savings", "1010"], ["My personal account (counted as money you took out)", "3300"]]);
    expect(o.at(-1).key).toBe(PERSONAL);
  });
  it("with no bank accounts set up, the main bank account", () => {
    expect(receivedIntoOptions({ bankAccounts: [], getAccountByRole: byRole })[0]).toMatchObject({ label: "Your bank account", code: "1000" });
  });
  it("★ received personally: Dr Owner's Draw / Cr Money owed to you — the sale was already counted; the business never held the cash", () => {
    const inv = { id: "i1", vendor: "Brand Co", amount: 2500, gl_code: "4450", gl_name: "Sponsorships", secondary_gl_code: "1100", secondary_gl_name: "Accounts Receivable", debit_credit: "credit" };
    const e = buildPaymentEntry(inv, "ar", { arCode: "1100", cashCode: "3300", cashName: "Owner's Draw / Distributions" });
    expect(e).toMatchObject({ gl_code: "3300", debit_credit: "debit", secondary_gl_code: "1100", amount: 2500 });
  });
  it("says where it went", () => {
    expect(receivedIntoCopy({ key: PERSONAL })).toBe("received into your personal account — counted as money you took out");
  });
});

describe("the three places a payment is marked received", () => {
  it.each(["src/components/views/ArView.jsx", "src/components/views/BooksView.jsx", "src/components/views/SendInvoiceView.jsx"])("%s offers the choice and posts into it", (f) => {
    const s = readFileSync(f, "utf8");
    expect(s).toMatch(/<ReceivedIntoSelect value=\{recvFor\[inv\.id\]\}/);
    expect(s).toMatch(/side: ?"ar", \.\.\.\(into \? \{ cashCode: into\.code, cashName: into\.name \} : \{\}\)/);
  });
});
