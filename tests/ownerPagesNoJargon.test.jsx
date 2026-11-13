import { describe, it, expect } from "vitest";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED, ACCOUNTS } from "./helpers/populatedFixture.js";
import { OWNER_JARGON_RE } from "../src/lib/clarify.js";
import { ownerAccountName, categoryLabel } from "../src/lib/categoryLabel.js";
import { CLIENT_VIEW_IDS, ALL_VIEW_IDS } from "../src/lib/nav.js";

import MoneyView from "../src/components/views/MoneyView.jsx";
import BooksView from "../src/components/views/BooksView.jsx";
import ApView from "../src/components/views/ApView.jsx";
import ArView from "../src/components/views/ArView.jsx";
import CustomersView from "../src/components/views/CustomersView.jsx";
import VendorsView from "../src/components/views/VendorsView.jsx";
import DocsView from "../src/components/views/DocsView.jsx";
import SendInvoiceView from "../src/components/views/SendInvoiceView.jsx";
import SettingsView from "../src/components/views/SettingsView.jsx";
import TaxView from "../src/components/views/TaxView.jsx";
import Tax1099View from "../src/components/views/Tax1099View.jsx";
import RecurringView from "../src/components/views/RecurringView.jsx";
import RulesView from "../src/components/views/RulesView.jsx";
import CoaView from "../src/components/views/CoaView.jsx";
import OpeningBalancesView from "../src/components/views/OpeningBalancesView.jsx";
import MoreSettingsView from "../src/components/views/MoreSettingsView.jsx";
import DashboardView from "../src/components/views/DashboardView.jsx";
import TeamView from "../src/components/views/TeamView.jsx";
import AuditView from "../src/components/views/AuditView.jsx";
import ReportsView from "../src/components/views/ReportsView.jsx";
import { OWNER_REPORT_TABS, OWNER_MORE_REPORT_TABS } from "../src/lib/reportGuide.js";

// ═════════════════════════════════════════════════════════════════════════════
// C643 — EVERY PAGE AN OWNER CAN OPEN, RENDERED WITH A REAL-SHAPED COMPANY, READ FOR ACCOUNTING
// WORDS. The guards before this checked sentences (toasts, audit lines, the chat guide); none read
// the PAGES. A sweep found "Accounts Payable", "Accounts Receivable", "Sales Tax Payable" and
// "Payroll Taxes Payable" on five of them — the built-in account names, shown as categories.
// ═════════════════════════════════════════════════════════════════════════════
const PAGES = {
  MoneyView, BooksView, ApView, ArView, CustomersView, VendorsView, DocsView, SendInvoiceView, SettingsView,
  TaxView, Tax1099View, RecurringView, RulesView, CoaView, OpeningBalancesView, MoreSettingsView, DashboardView, TeamView, AuditView,
  // Not QBOImportView: it tells the owner where to click in QuickBooks, by QuickBooks' own menu names.
};
const owner = { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS };
const textOf = (html) => html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<(option|input|textarea)[^>]*value="[^"]*"/g, "<$1").replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const render = (C, name, seat, extra = {}) => renderViewHtml(C, { ...POPULATED, ...(VIEW_CONTEXT[`${name}.jsx`] || {}), CHART_OF_ACCOUNTS: ACCOUNTS, BOOKABLE_ACCOUNTS: ACCOUNTS,
  navSeat: seat, companyDataLoaded: true, booksFilter: "all", ...extra });
const jargonIn = (text) => [...text.matchAll(new RegExp(OWNER_JARGON_RE.source, "gi"))].map((m) => text.slice(Math.max(0, m.index - 30), m.index + 30));

describe("no accounting words on an owner's pages", () => {
  for (const [name, C] of Object.entries(PAGES)) {
    it(`★ ${name}`, () => {
      expect(jargonIn(textOf(render(C, name, owner)))).toEqual([]);
    });
  }
  // C644 — every report an owner can open, including the ones under "More reports".
  for (const [type, label] of [...OWNER_REPORT_TABS, ...OWNER_MORE_REPORT_TABS]) {
    it(`★ Reports → ${label}`, () => {
      const text = textOf(render(ReportsView, "ReportsView", owner, { reportType: type, reportDateTo: "2026-06-30", openingBalances: [] }));
      expect(jargonIn(text)).toEqual([]);
    });
  }
  it("★ the owner's balance sheet: plain title, a real date, and a footnote that names the page by its name", () => {
    const text = textOf(render(ReportsView, "ReportsView", owner, { reportType: "balance", reportDateTo: "2026-06-30", openingBalances: [] }));
    expect(text).toMatch(/What you own and owe As of June 30, 2026/);
    expect(text).toMatch(/Settings → More settings → Starting balances/);
    expect(text).toMatch(/WHAT YOU OWN .*Money owed to you \$1,299\.00/);
    expect(text).toMatch(/WHAT YOU OWE .*Bills you owe \$1,432\.30/);
    expect(text).toMatch(/WHAT'S YOURS/);
  });
  it("a saved date that isn't a date reads as today, never 'Invalid Date'", () => {
    const text = textOf(render(ReportsView, "ReportsView", owner, { reportType: "balance", reportDateTo: "not-a-date" }));
    expect(text).not.toMatch(/Invalid Date/);
  });
  it("the accountant's balance sheet keeps its name", () => {
    const text = textOf(render(ReportsView, "ReportsView", { seat: "reviewer", isReviewerSeat: true, sections: [], viewIds: ALL_VIEW_IDS }, { reportType: "balance", reportDateTo: "2026-06-30" }));
    expect(text).toMatch(/Balance Sheet/);
    expect(text).toMatch(/Accounts Payable/);
    expect(text).toMatch(/STOCKHOLDERS' EQUITY/);
  });
  it("the sweep can find something: the accountant's Categories page uses the accounting names", () => {
    const text = textOf(render(CoaView, "CoaView", { seat: "reviewer", isReviewerSeat: true, sections: [], viewIds: ALL_VIEW_IDS }));
    expect(text).toMatch(/Accounts Payable/);
  });
});

describe("the plain names", () => {
  it("★ the built-in names translate on the owner's seat; a name the owner typed is left alone", () => {
    expect(ownerAccountName("Accounts Payable")).toBe("Bills you owe");
    expect(ownerAccountName("accounts receivable")).toBe("Money owed to you");
    expect(ownerAccountName("Sales Tax Payable")).toBe("Sales tax you've collected");
    expect(ownerAccountName("Ace Equipment Loan")).toBe("Ace Equipment Loan");
    expect(categoryLabel("2000", "Accounts Payable")).toBe("Bills you owe");
    expect(categoryLabel("2000", "Accounts Payable", { withCode: true })).toBe("2000 · Accounts Payable");
  });
});
