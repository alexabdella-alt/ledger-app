import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { openPayablesGL } from "../src/lib/reports.js";
import { renderViewHtml } from "./helpers/renderView.jsx";
import VendorsView from "../src/components/views/VendorsView.jsx";
import { buildVendorSummary } from "../src/lib/vendorSummary.js";

// ═════════════════════════════════════════════════════════════════════════════
// C453 — "BILLS YOU STILL OWE" ON THE VENDORS SCREEN COUNTED A CARD PURCHASE AS A BILL, AND
// "PAID YTD" COUNTED IT NOWHERE. Open = the A/P-leg rule (C309); paid = spent minus open.
// ═════════════════════════════════════════════════════════════════════════════
const AP = "2000", CASH = "1000", EXP = "5010";
const chart = [{ code: AP, name: "Accounts Payable", category: "Liabilities", system_role: "accounts_payable" }, { code: CASH, name: "Cash", category: "Assets", system_role: "cash" }, { code: EXP, name: "Food Cost", category: "Expenses" }];
const byRole = (r) => chart.find((a) => a.system_role === r) || null;
const card = { id: "c1", vendor: "Sysco", vendor_key: "sysco", amount: 300, date: "2026-09-02", gl_code: EXP, secondary_gl_code: CASH, type: "expense", status: "booked", source: "bank_import" };
const bill = { id: "b1", vendor: "Sysco", vendor_key: "sysco", amount: 500, date: "2026-09-03", gl_code: EXP, secondary_gl_code: AP, type: "expense", status: "booked", source: "universal_upload" };

describe("C453", () => {
  it("the rule: a card purchase is not an open bill; an A/P-offset bill is", () => {
    expect(openPayablesGL([card], AP)).toEqual([]);
    expect(openPayablesGL([bill], AP).map((i) => i.id)).toEqual(["b1"]);
  });
  it("rendered: PAID YTD counts the card purchase, and only the bill is owed", () => {
    const invoices = [card, bill];
    const ctx = { contacts: [], invoices, CHART_OF_ACCOUNTS: chart, getAccountByRole: byRole, companyDataLoaded: true, loadFailures: {}, vendorsEditingId: null, vendorsSelectedContact: null, aliasIndex: new Map(), vendorSummary: buildVendorSummary(invoices, new Map()) };
    const html = renderViewHtml(VendorsView, ctx).replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ");
    expect(html).toMatch(/PAID YTD\s+\$300\.00/);
    expect(html).toMatch(/(STILL OWED|OWE)[^$]{0,40}\$500\.00/i);
  });
  it("source: the Vendors screen reads openPayablesGL, not the flag", () => {
    const src = fs.readFileSync("src/components/views/VendorsView.jsx", "utf8");
    expect(src).toMatch(/const openAPfor = name => openPayablesGL\(allForVendor\(name\), apRoleCode\)/);   // C515 — off the vendor's FULL ledger rows
    expect(src).not.toMatch(/txns\.filter\(i=>i\.payment_status!=="paid"\)\.reduce/);
  });
});
