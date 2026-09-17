import { describe, it, expect } from "vitest";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED, INVOICES } from "./helpers/populatedFixture.js";
import DashboardView from "../src/components/views/DashboardView.jsx";
import { CLIENT_VIEW_IDS } from "../src/lib/nav.js";

// C527 — Home's Activity feed lists one line per entry. With the render fixture now coming out of
// the real flatten, the two-line Sysco bill (i7) rendered as THREE lines — its Food line, its
// Freight line and "Sysco — Accounts Payable −$520.00", the offset leg.
const text = (h) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("C527 — Home's activity feed is one line per entry", () => {
  it("the fixture is faithful: the two-line bill is three flattened rows sharing one entry id", () => {
    expect(INVOICES.filter((r) => r.db_entry_id === "i7").length).toBe(3);
  });
  it("renders the bill once, at $520, with a lines hint — never its A/P leg", () => {
    const navSeat = { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS };
    const t = text(renderViewHtml(DashboardView, { ...POPULATED, ...VIEW_CONTEXT["DashboardView.jsx"], navSeat, companyDataLoaded: true }));
    expect(t).toContain("Sysco — Food Cost · 3 lines");
    expect(t).toContain("520.00");
    expect(t).not.toContain("Sysco — Accounts Payable");
    expect(t).not.toContain("Sysco — Freight");
    expect((t.match(/Sysco —/g) || []).length).toBe(1);
  });
});

// C538 — a settlement on Home's feed is described as what it did. The fixture's February payment
// of the January bill read "Payment — Accounts Payable −$824.60"; a collection would have read as
// money OUT of "Cash".
describe("C538 — Home's activity feed describes settlements", () => {
  const navSeat = { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS };
  it("the payment reads 'Paid Hill Country Milling Co.' as money out; the A/P leg's name never shows", () => {
    expect(INVOICES.find((r) => r.id === "i9").import_metadata.payment_for).toBe("i1");   // the shape under test
    const t = text(renderViewHtml(DashboardView, { ...POPULATED, ...VIEW_CONTEXT["DashboardView.jsx"], navSeat, companyDataLoaded: true }));
    expect(t).toContain("Paid Hill Country Milling Co.");
    expect(t).not.toContain("Accounts Payable");
    expect(t).not.toContain("Payment —");
  });
  it("a collection reads as money IN from the customer", () => {
    const rows = [...INVOICES, { id: "c1", vendor: "Acme", amount: 300, date: "2026-03-20", gl_code: "1000", gl_name: "Cash", secondary_gl_code: "1100", secondary_gl_name: "Accounts Receivable", debit_credit: "debit", type: "expense", status: "booked", payment_status: "paid", description: "Collection – Acme", import_metadata: { kind: "ar_collection", payment_for: "x" } }];
    const t = text(renderViewHtml(DashboardView, { ...POPULATED, ...VIEW_CONTEXT["DashboardView.jsx"], navSeat, invoices: rows, companyDataLoaded: true }));
    expect(t).toMatch(/💰 Received from Acme[^🧾💰]*\+\$300\.00/);
  });
});

// C540 — a correction on Home's feed is not income: the fixture's reversal of the Bluebonnet bill
// read 💰 "Bluebonnet Linen Service — Linen & Laundry +$145.00".
describe("C540 — a correction is labelled as one", () => {
  it("reads '↩ Corrected: Bluebonnet Linen Service'", () => {
    const navSeat = { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS };
    expect(INVOICES.find((r) => r.id === "i10").import_metadata.reverses).toBe("i3");   // the shape under test
    const t = text(renderViewHtml(DashboardView, { ...POPULATED, ...VIEW_CONTEXT["DashboardView.jsx"], navSeat, companyDataLoaded: true }));
    expect(t).toContain("↩ Corrected: Bluebonnet Linen Service");
    expect(t).not.toMatch(/💰 Bluebonnet/);
  });
});

// C543 — Reports' "N transactions" counts entries, not flattened lines.
import ReportsView from "../src/components/views/ReportsView.jsx";
describe("C543 — Reports counts entries", () => {
  it("the P&L subtitle counts one per entry", () => {
    const navSeat = { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS };
    const plRows = INVOICES.filter((r) => /^[4-8]/.test(String(r.gl_code)) && r.status !== "voided");
    const lines = plRows.length, entries = new Set(plRows.map((r) => r.db_entry_id)).size;
    expect(lines).toBeGreaterThan(entries);   // the fixture has multi-line entries, so the two differ
    const t = text(renderViewHtml(ReportsView, { ...POPULATED, ...VIEW_CONTEXT["ReportsView.jsx"], navSeat, companyDataLoaded: true, reportRange: "all" }));
    expect(t).toContain(`${entries} transactions`);
    expect(t).not.toContain(`${lines} transactions`);
  });
});
