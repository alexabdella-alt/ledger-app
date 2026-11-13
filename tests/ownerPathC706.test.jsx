// C706 — fixes from the owner's-everyday-path audit.
import { describe, it, expect, vi } from "vitest";
vi.mock("react-dom", async (orig) => ({ ...(await orig()), createPortal: (c) => c }));
import { readFileSync } from "node:fs";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED, ACCOUNTS } from "./helpers/populatedFixture.js";
import { CLIENT_VIEW_IDS } from "../src/lib/nav.js";
import MoneyView from "../src/components/views/MoneyView.jsx";
import { classifyTxn, txnStatus } from "../src/lib/txnPresent.js";
import { openPayablesGL, openReceivablesGL } from "../src/lib/reports.js";
import { bankCategoryOptions } from "../src/lib/bankAccounts.js";
import { homeWaitingList } from "../src/lib/homeWaiting.js";
import { ownerAccountName } from "../src/lib/categoryLabel.js";

const owner = { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS };
const textOf = (html) => html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const money = (f, extra = {}) => textOf(renderViewHtml(MoneyView, { ...POPULATED, ...(VIEW_CONTEXT["MoneyView.jsx"] || {}), CHART_OF_ACCOUNTS: ACCOUNTS, BOOKABLE_ACCOUNTS: ACCOUNTS, navSeat: owner, companyDataLoaded: true, booksFilter: f, ...extra }));

describe("C706 — equipment bought is a purchase, not money in", () => {
  it("an oven on terms is an open bill to pay; from the bank it's money out", () => {
    const onTerms = { id: "e1", gl_code: "1500", secondary_gl_code: "2000", debit_credit: "debit", amount: 4625, payment_status: "unpaid", status: "booked" };
    const c = classifyTxn(onTerms, { apCode: "2000", arCode: "1100" });
    expect(c.inflow).toBe(false);
    expect(c.settleAction).toBe("pay");
    expect(txnStatus(onTerms, c).label).toBe("Open");
    expect(classifyTxn({ ...onTerms, secondary_gl_code: "1000" }, { apCode: "2000" }).inflow).toBe(false);
  });
  it("money landing in a bank is still money in; the starting balance unchanged", () => {
    expect(classifyTxn({ id: "d", gl_code: "1000", secondary_gl_code: "3300", debit_credit: "debit", amount: 2000 }, { apCode: "2000" }).inflow).toBe(true);
    expect(classifyTxn({ id: "o", gl_code: "1500", secondary_gl_code: "3400", debit_credit: "debit", amount: 9000, source: "opening_balance" }, {}).inflow).toBe(true);
  });
});

describe("C706 — Money's figures open the lists they count", () => {
  it("'Bills to pay' lists every open bill the figure counts", () => {
    const n = openPayablesGL(POPULATED.invoices, "2000").length;
    const t = money("unpaid");
    expect(n).toBeGreaterThan(0);
    expect(readFileSync("src/components/views/BooksView.jsx", "utf8")).toMatch(/const listed = filter === "unpaid" \? openPayablesGL\(scopedInvoices, apCode\)/);
    expect(t).not.toMatch(/\+\s*\$0\.00/);
  });
  it("'Owed to you' never shows a taxed invoice as +$0.00", () => {
    const open = openReceivablesGL(POPULATED.invoices, "1100");
    const t = money("owed");
    expect(open.length).toBeGreaterThan(0);
    expect(t).toMatch(/INV-0002[^$]*\+\s*\$1,299\.00/);
    expect(t).not.toMatch(/\+\s*\$0\.00/);
  });
  it("the Income filter keeps an entry whole (no +$0.00)", () => {
    expect(money("revenue")).not.toMatch(/\+\s*\$0\.00/);
    expect(money("revenue")).toMatch(/INV-0002[^$]*\+\s*\$1,299\.00/);
  });
});

describe("C706 — a bank account is filed only under a bank-like category", () => {
  const chart = [{ code: "1000", name: "Cash", system_role: "cash" }, { code: "1010", name: "Savings", system_role: "savings" }, { code: "1100", name: "Accounts Receivable", system_role: "accounts_receivable" },
    { code: "2000", name: "Accounts Payable", system_role: "accounts_payable" }, { code: "2200", name: "Credit Card Liability", system_role: "credit_card_liability" }, { code: "2350", name: "Sales Tax Payable", system_role: "sales_tax_payable" },
    { code: "2600", name: "Notes Payable", system_role: "notes_payable" }, { code: "2210", name: "Chase Visa" }];
  const codes = (t, cur) => bankCategoryOptions(chart, t, cur).map((a) => a.code);
  it("checking: cash accounts only; card: cards; loan: loans", () => {
    expect(codes("checking")).toEqual(["1000", "1010"]);
    expect(codes("credit_card")).toEqual(["2200", "2210"]);
    expect(codes("loan")).toEqual(["2600"]);
  });
  it("the current category is always kept", () => {
    expect(codes("checking", "2000")[0]).toBe("2000");
  });
  it("Settings uses it", () => {
    expect(readFileSync("src/components/views/SettingsView.jsx", "utf8")).toMatch(/bankCategoryOptions\(BOOKABLE_ACCOUNTS\|\|\[\], ba\.type, ba\.gl_code\)/);
  });
});

describe("C706 — a view-only teammate isn't offered what will be refused", () => {
  it("no invite on Home", () => {
    const q = [{ status: "done", type: "contract" }];
    expect(JSON.stringify(homeWaitingList({ hasAccountant: false, uploadQueue: q }))).toMatch(/Invite your accountant/);
    expect(JSON.stringify(homeWaitingList({ hasAccountant: false, uploadQueue: q, canInvite: false }))).not.toMatch(/Invite your accountant/);
  });
  it("no Send an invoice on Money — a note instead; payment buttons gated on every list", () => {
    const t = money("all", { isViewer: true });
    expect(t).not.toMatch(/Send an invoice/);
    expect(t).toMatch(/You have view-only access/);
    expect(t).not.toMatch(/Mark Paid|Mark Received/);
    for (const f of ["ApView", "ArView", "VendorsView", "SendInvoiceView", "BooksView"]) expect(readFileSync(`src/components/views/${f}.jsx`, "utf8")).toMatch(/isViewer/);
  });
});

describe("C706 — plain words on the owner's reports", () => {
  it("P&L headings and the payroll tax name", () => {
    const r = readFileSync("src/components/views/ReportsView.jsx", "utf8");
    expect(r).toMatch(/ownerSeat \? "COST OF WHAT YOU SELL" : "COST OF REVENUE"/);
    expect(r).toMatch(/ownerSeat \? "RUNNING COSTS" : "OPERATING EXPENSES"/);
    expect(r).toMatch(/ownerSeat \? "Cash in and out" : "Cash Flow Statement"/);
    expect(r).toMatch(/\{ownerSeat \? ownerAccountName\(row\.name\) : row\.name\}/);
    expect(ownerAccountName("Payroll Tax Expense")).toBe("Payroll taxes");
  });
});

describe("C706 — dates read as dates", () => {
  it("the 'by how late' tab formats the due date", () => {
    expect(readFileSync("src/components/views/ArView.jsx", "utf8")).toMatch(/\{inv\.due_date \? fmtDate\(inv\.due_date\) : "—"\}/);
  });
});
