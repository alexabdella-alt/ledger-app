import { describe, it, expect } from "vitest";
import { nextFreeCode, codeForNewCategory, CATEGORY_KIND_OPTION } from "../src/lib/categoryLabel.js";
import { readFileSync } from "fs";
import { renderViewHtml } from "./helpers/renderView.jsx";
import CoaView from "../src/components/views/CoaView.jsx";
import OpeningBalancesView from "../src/components/views/OpeningBalancesView.jsx";

const text = (h) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const OWNER = { isReviewerSeat: false };
const CHART = [
  { code: "1000", name: "Cash", category: "Assets" }, { code: "2000", name: "Accounts Payable", category: "Liabilities" },
  { code: "6000", name: "Salaries", category: "Expenses" }, { code: "6010", name: "Payroll Tax", category: "Expenses" },
];

describe("C578 — the setup screens speak an owner's language", () => {
  it("a new category's number is chosen for the owner: the next free one in its type's range", () => {
    expect(nextFreeCode("Expenses", CHART)).toBe("6020");
    expect(nextFreeCode("Revenue", CHART)).toBe("4000");
    expect(nextFreeCode("Assets", CHART)).toBe("1010");
    expect(nextFreeCode("Nonsense", CHART)).toBeNull();
    const full = Array.from({ length: 1000 }, (_, i) => ({ code: String(4000 + i) }));
    expect(nextFreeCode("Revenue", full)).toBeNull();
  });
  it("a typed code is kept; a blank one is chosen — and the screen saves through that", () => {
    expect(codeForNewCategory({ code: " 6550 ", category: "Expenses" }, CHART)).toBe("6550");
    expect(codeForNewCategory({ code: "", category: "Expenses" }, CHART)).toBe("6020");
    expect(readFileSync("src/components/views/CoaView.jsx", "utf8")).toMatch(/const code = codeForNewCategory\(addDraft, CHART_OF_ACCOUNTS\);/);
  });
  it("Categories: an owner adds a category by name and type — no number to invent", () => {
    const t = text(renderViewHtml(CoaView, { navSeat: OWNER, accountsLoadOk: true, CHART_OF_ACCOUNTS: CHART, coaShowAdd: true, coaAddDraft: { code: "", name: "", category: "Expenses" } }));
    expect(t).toMatch(/\+ Add category/);
    expect(t).toMatch(/NEW CATEGORY/);
    expect(t).not.toMatch(/\bCODE\b/);
    expect(t).toContain(CATEGORY_KIND_OPTION.Expenses);
    expect(t).toMatch(/COSTS — 2 categories/);
    expect(t).not.toMatch(/\b6000\b/);
  });
  it("Categories: the accountant keeps the number field, which may be left blank", () => {
    const t = text(renderViewHtml(CoaView, { navSeat: { isReviewerSeat: true }, accountsLoadOk: true, CHART_OF_ACCOUNTS: CHART, coaShowAdd: true, coaAddDraft: { code: "", name: "", category: "Expenses" } }));
    expect(t).toMatch(/CODE \(blank = next free\)/);
    expect(t).toMatch(/\b6000\b/);
  });
  it("Starting balances: plain sections, no account numbers, 'Save starting balances'", () => {
    const t = text(renderViewHtml(OpeningBalancesView, { navSeat: OWNER, BOOKABLE_ACCOUNTS: CHART, CHART_OF_ACCOUNTS: CHART, cutoffDate: "2026-01-01", openingPosted: false, bankAccounts: [], openingBalBalances: {}, openingBalances: [] }));
    expect(t).toMatch(/Start date:/);
    expect(t).toMatch(/WHAT THE BUSINESS HAS/);
    expect(t).toMatch(/WHAT THE BUSINESS OWES/);
    expect(t).toMatch(/Starting equity/);
    expect(t).toMatch(/Save starting balances/);
    expect(t).not.toMatch(/Opening Balance Equity|Cutoff date|Post Opening Balances|\b1000\b/);
  });
});
