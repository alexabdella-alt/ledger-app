import { describe, it, expect, vi } from "vitest";
vi.mock("react-dom", async (orig) => ({ ...(await orig()), createPortal: (c) => c }));
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED, ACCOUNTS } from "./helpers/populatedFixture.js";
import { OWNER_JARGON_RE } from "../src/lib/clarify.js";
import { CLIENT_VIEW_IDS } from "../src/lib/nav.js";
import MoneyView from "../src/components/views/MoneyView.jsx";
import ArView from "../src/components/views/ArView.jsx";
import ApView from "../src/components/views/ApView.jsx";
import ReportsView from "../src/components/views/ReportsView.jsx";
import { OWNER_REPORT_TABS, OWNER_MORE_REPORT_TABS } from "../src/lib/reportGuide.js";

// ═════════════════════════════════════════════════════════════════════════════
// C707 — THE NO-JARGON GUARD READS EVERY STATE, NOT ONLY THE DEFAULT ONE. The C643 sweep rendered
// each page once, in its default state — so Money's filters, the three "owed to you" tabs and the
// paid-bills tab were never read, and the C706 audit found "+$0.00" and raw dates there that no
// test could see. And the reports' accounting headings ("COST OF REVENUE", "Operating Income",
// "Cash Flow Statement") were outside the word list, so they're named here for the owner seat.
// ═════════════════════════════════════════════════════════════════════════════
const owner = { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS };
const textOf = (html) => html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<(option|input|textarea)[^>]*value="[^"]*"/g, "<$1").replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const render = (C, name, extra = {}) => textOf(renderViewHtml(C, { ...POPULATED, ...(VIEW_CONTEXT[`${name}.jsx`] || {}), CHART_OF_ACCOUNTS: ACCOUNTS, BOOKABLE_ACCOUNTS: ACCOUNTS,
  navSeat: owner, companyDataLoaded: true, booksFilter: "all", ...extra }));
const REPORT_WORDS = /Profit & Loss Statement|COST OF REVENUE|OPERATING EXPENSES|Operating Income|Gross Profit|Cash Flow Statement|Cash basis|Net income|Payroll Tax Expense/i;
const problems = (text) => [...[...text.matchAll(new RegExp(OWNER_JARGON_RE.source, "gi"))].map((m) => text.slice(Math.max(0, m.index - 30), m.index + 30)),
  ...[...text.matchAll(new RegExp(REPORT_WORDS.source, "gi"))].map((m) => m[0]),
  ...(/\+\s*\$0\.00/.test(text) ? ["+$0.00"] : []), ...[...text.matchAll(/\b20\d\d-\d\d-\d\d\b/g)].map((m) => `raw date ${m[0]}`)];

describe("C707 — every state an owner can reach, read for jargon, $0.00 rows and raw dates", () => {
  for (const f of ["all", "unpaid", "owed", "revenue", "expenses", "review"]) {
    it(`Money → ${f}`, () => expect(problems(render(MoneyView, "MoneyView", { booksFilter: f }))).toEqual([]));
  }
  for (const tab of ["inbox", "collections", "aging"]) {
    it(`Owed to you → ${tab}`, () => expect(problems(render(ArView, "ArView", { arView: tab }))).toEqual([]));
  }
  for (const tab of ["unpaid", "paid"]) {
    it(`Bills → ${tab}`, () => expect(problems(render(ApView, "ApView", { apView: tab }))).toEqual([]));
  }
  for (const [type, label] of [...OWNER_REPORT_TABS, ...OWNER_MORE_REPORT_TABS]) {
    it(`Reports → ${label}`, () => expect(problems(render(ReportsView, "ReportsView", { reportType: type, reportDateTo: "2026-06-30", openingBalances: [] }))).toEqual([]));
  }
});
