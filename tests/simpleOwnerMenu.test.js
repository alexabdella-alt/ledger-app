import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { visibleNav, activeNavItem, canSeeView, MONEY_GROUP, NAV_ACTIONS } from "../src/lib/nav.js";
import { moneySummary, moneyLinks, OWNER_MONEY_FILTERS, MONEY_PAGE_COPY } from "../src/lib/moneyPage";
import BooksView from "../src/components/views/BooksView.jsx";
import { renderViewHtml } from "./helpers/renderView.jsx";
import MoneyView from "../src/components/views/MoneyView.jsx";

// C636 — the owner's menu: Home · Money · Reports · Ask, plus Settings. Nothing removed.
const owner = { role: "owner" };
const rows = (nav) => nav.sections.flatMap((s) => s.items.map(([id]) => id));

describe("the owner's menu", () => {
  it("★ is five places and Settings (C729 — Taxes joined the main menu)", () => {
    expect(rows(visibleNav(owner))).toEqual(["home", "money", "tax", "reports", "ask", "settings"]);
    // standing on Taxes doesn't open the Settings rows
    expect(rows(visibleNav({ ...owner, inSettings: true, currentView: "tax" }))).toEqual(["home", "money", "tax", "reports", "ask", "settings"]);
  });
  it("★ every list the old menu had is still openable, and opening it highlights Money", () => {
    for (const v of ["books", "ap", "ar", "customers", "vendors", "docs", "send-invoice"]) {
      expect([v, canSeeView(v, owner)]).toEqual([v, true]);
      expect([v, activeNavItem(v, { seat: "client" })]).toEqual([v, "money"]);
    }
  });
  it("the accountant's menu is unchanged, and their lists highlight themselves", () => {
    expect(rows(visibleNav({ role: "accountant" }))).toEqual(["home", "books", "ap", "ar", "customers", "vendors", "docs", "reports", "review"]);
    expect(activeNavItem("ap", { seat: "reviewer" })).toBe("ap");
  });
  it("★ in Settings, the owner sees three rows (C638; C729 — Taxes moved to the main menu) — and every setup page is still openable", () => {
    const r = rows(visibleNav({ ...owner, inSettings: true }));
    expect(r.slice(-3)).toEqual(["settings", "team", "settings-more"]);
    expect(r.filter((x) => x === "settings")).toHaveLength(1);
    for (const v of ["coa", "opening-balances", "rules", "recurring", "audit", "onboard", "tax1099"]) {
      expect([v, canSeeView(v, owner)]).toEqual([v, true]);
      expect([v, activeNavItem(v, { seat: "client" })]).toEqual([v, v === "tax1099" ? "tax" : "settings-more"]);
    }
  });
  it("the accountant's Settings keeps every row", () => {
    const r = rows(visibleNav({ role: "accountant", inSettings: true }));
    for (const v of ["coa", "opening-balances", "rules", "recurring", "tax1099", "audit", "onboard"]) expect(r).toContain(v);
    expect(r).not.toContain("settings-more");
  });
  it("★ Ask is an action that opens the assistant, not a page", () => {
    expect(NAV_ACTIONS).toEqual(["ask"]);
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/const go = \(id\) => \{\s*\n\s*if \(id === "ask"\) \{ setChatOpen\(true\); return; \}/);
    expect(app).toMatch(/\{view==="money" && <MoneyView \/>\}/);
  });
});

describe("the Money page is one list (C637)", () => {
  it("★ two figures that set the list's filter, in plain words", () => {
    const [owe, owed] = moneySummary({ owe: 4306, billsOpen: 2, owed: 1086.25, invoicesOpen: 1 });
    expect([owe.filter, owe.label, owe.figure, owe.sub]).toEqual(["unpaid", "You owe", "$4,306.00", "2 bills to pay"]);
    expect([owed.filter, owed.label, owed.figure, owed.sub]).toEqual(["owed", "Owed to you", "$1,086.25", "1 invoice not paid yet"]);
    const [z1, z2] = moneySummary({});
    expect([z1.sub, z2.sub]).toEqual(["All paid up", "Nothing outstanding"]);
  });

  it("★ the owner's filters are named the way an owner would", () => {
    expect(OWNER_MONEY_FILTERS.map(([, l]) => l)).toEqual(["All", "Bills to pay", "Owed to you", "Income", "Spending", "Needs a look"]);
  });

  it("people and files stay one click away", () => {
    expect(moneyLinks({ contacts: [{ type: "vendor" }, { type: "customer" }, { type: "vendor" }], docs: [{}] }).map((l) => [l.view, l.count]))
      .toEqual([["customers", 1], ["vendors", 2], ["docs", 1]]);
  });

  it("★ renders the figures, the embedded list with the owner's filters, and the links", () => {
    const html = renderViewHtml(MoneyView, { invoices: [], contacts: [], docLibrary: [], getAccountByRole: () => null, navSeat: { isReviewerSeat: false }, booksFilter: "all", companyDataLoaded: true });
    for (const f of ["unpaid", "owed"]) expect(html).toContain(`data-money-figure="${f}"`);
    for (const [, label] of OWNER_MONEY_FILTERS) expect(html).toContain(`>${label}<`);
    for (const v of ["customers", "vendors", "docs"]) expect(html).toContain(`data-money-link="${v}"`);
    expect(html).toContain("data-money-send-invoice");
    expect(html).not.toContain("All transactions");   // the list's own title is not repeated inside Money
  });

  it("★ 'Owed to you' lists exactly the invoices not paid yet", () => {
    const AR = { id: "ar", code: "1100", name: "A/R", system_role: "accounts_receivable" };
    const rows = [
      { id: "i1", vendor: "Harbor Cafe", amount: 900, date: "2026-03-01", gl_code: "4100", gl_name: "Sales", secondary_gl_code: "1100", debit_credit: "credit", status: "booked", payment_status: "unpaid" },
      { id: "i2", vendor: "Paid Co", amount: 500, date: "2026-03-02", gl_code: "4100", gl_name: "Sales", secondary_gl_code: "1100", debit_credit: "credit", status: "booked", payment_status: "collected" },
      { id: "b1", vendor: "Ace", amount: 100, date: "2026-03-03", gl_code: "6250", gl_name: "Repairs", secondary_gl_code: "2000", debit_credit: "debit", status: "booked", payment_status: "unpaid" },
    ];
    const html = renderViewHtml(BooksView, { invoices: rows, navSeat: { isReviewerSeat: false }, booksFilter: "owed", companyDataLoaded: true,
      getAccountByRole: (r) => (r === "accounts_receivable" ? AR : r === "accounts_payable" ? { code: "2000" } : null), rc: (r) => (r === "accounts_receivable" ? "1100" : r === "accounts_payable" ? "2000" : null) }, { embedded: true });
    expect(html).toContain("Harbor Cafe");
    expect(html).not.toContain("Paid Co");
    expect(html).not.toContain(">Ace<");
  });
});
