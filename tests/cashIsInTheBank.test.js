import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { cashOnHandCodes, glCashOnHand } from "../src/lib/reports.js";
import { flattenJournalEntries } from "../src/lib/ledger.js";

// C666 — a credit card or loan linked as a bank account is not cash.
const ACC = [["1000","Cash"],["1010","Savings Account"],["2200","Credit Card Liability"],["2500","Long-Term Debt"],["6600","Office Supplies"],["3400","Opening Balance Equity"]].map(([code,name])=>({code,name}));
const je = (id, lines, extra = {}) => ({ id, entry_date: "2026-03-10", description: id, status: "posted", deleted_at: null, source: "bank_import", created_at: "2026-03-10T10:00:00Z",
  journal_entry_lines: lines.map((l,n)=>({ id:`${id}-${n}`, debit:l[1], credit:l[2], accounts:{ code:l[0], name: ACC.find(a=>a.code===l[0]).name } })), ...extra });
const rows = flattenJournalEntries([
  je("open", [["1000",5000,0],["3400",0,5000]], { source: "opening_balance" }),
  je("supplies on card", [["6600",1240,0],["2200",0,1240]]),
], ACC);

describe("★ cash on hand counts what is in the bank", () => {
  it("only asset accounts are cash", () => expect(cashOnHandCodes(["1000", "1010", "2200", "2500", "1000"])).toEqual(["1000", "1010"]));
  it("★ $1,240 owed on the card is not added to $5,000 in the bank", () => {
    expect(glCashOnHand(rows, ["1000", "2200"])).toBe(6240);                  // the bug: the old set
    expect(glCashOnHand(rows, cashOnHandCodes(["1000", "2200"]))).toBe(5000); // the fix
  });
  it("the app's cash set is filtered; the matcher and Review keep the cards (a card payment is a payment)", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/const cashGlCodes = useMemo\(\(\) => cashOnHandCodes\(paymentSourceGlCodes\), \[paymentSourceGlCodes\]\);/);
    expect(app).toMatch(/planInvoiceArrival\(invoice, arrivalLedger, \{\s*\n\s*cashCodes: paymentSourceGlCodes,/);
  });
});

// C667 — Settings' total of entered balances.
import { statementBalanceTotals } from "../src/lib/bankAccounts.js";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED, ACCOUNTS } from "./helpers/populatedFixture.js";
import SettingsView from "../src/components/views/SettingsView.jsx";
describe("★ C667 — money in the bank and money owed are added up apart", () => {
  const banks = [{ id: "K", type: "checking", gl_code: "1000", current_balance: 5000 }, { id: "S", type: "savings", gl_code: "1010", current_balance: 2000 }, { id: "C", type: "credit_card", gl_code: "2200", current_balance: 1240 }];
  it("the card's balance is owed, not money", () => expect(statementBalanceTotals(banks)).toEqual({ inBank: 7000, owed: 1240 }));
  it("Settings shows $7,000.00 in the bank and the $1,240.00 owed beside it", () => {
    const t = renderViewHtml(SettingsView, { ...POPULATED, ...(VIEW_CONTEXT["SettingsView.jsx"] || {}), CHART_OF_ACCOUNTS: ACCOUNTS, bankAccounts: banks, companyDataLoaded: true }).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(t).toMatch(/owed on cards and loans: \$ ?1,240\.00/);
    expect(t).toMatch(/\$ ?7,000\.00/);
    expect(t).not.toMatch(/\$ ?8,240\.00/);
  });
});

// C671 — what is owed on cards shows on Home.
import { cardBalanceOwed, businessHealth } from "../src/lib/reports.js";
describe("★ C671 — Home shows what is owed on credit cards", () => {
  const banks = [{ id: "K", type: "checking", gl_code: "1000" }, { id: "C", type: "credit_card", gl_code: "2200" }, { id: "C2", type: "credit_card", gl_code: "2200" }];
  it("the cards' ledger account, counted once", () => expect(cardBalanceOwed(rows, banks)).toBe(1240));
  it("Home's numbers include 'On credit cards' when something is owed, and not otherwise", () => {
    expect(businessHealth(rows, { cash: 5000, onCards: 1240 }).ownerFacts.find((f) => f.key === "cards")).toMatchObject({ label: "On credit cards", value: "$1,240.00" });
    expect(businessHealth(rows, { cash: 5000, onCards: 0 }).ownerFacts.some((f) => f.key === "cards")).toBe(false);
  });
  it("Home passes it", () => {
    expect(readFileSync("src/components/views/DashboardView.jsx", "utf8")).toMatch(/onCards: cardBalanceOwed\(invoices, bankAccounts\),/);   // C726 — then the fiscal year
  });
});
