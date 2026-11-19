// ★ C744 — THE OWNER'S MONEY LIST SHOWS EACH PURCHASE ONCE. A removed bill carried a second
// "REVERSAL: … +$145 · Correction" row, and a paid bill a second "Payment – … −$824.60" row —
// to an owner, money leaving twice. Folded for the owner only; the accountant sees every entry.
import { describe, it, expect } from "vitest";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import MoneyView from "../src/components/views/MoneyView.jsx";
import BooksView from "../src/components/views/BooksView.jsx";
import { CLIENT_VIEW_IDS } from "../src/lib/nav.js";
import { ownerListView } from "../src/lib/txnPresent.js";

const owner = { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS };
const ownerHtml = () => renderViewHtml(MoneyView, { ...POPULATED, ...(VIEW_CONTEXT["MoneyView.jsx"] || {}), navSeat: owner, companyDataLoaded: true }).replace(/&#x27;/g, "'").replace(/<!-- -->/g, "");
const cockpitHtml = () => renderViewHtml(BooksView, { ...POPULATED, ...(VIEW_CONTEXT["BooksView.jsx"] || {}), navSeat: { seat: "reviewer", isReviewerSeat: true, sections: [] }, companyDataLoaded: true }).replace(/&#x27;/g, "'").replace(/<!-- -->/g, "");

describe("C744 — owner's list, rendered", () => {
  it("★★ no separate correction row and no separate payment row", () => {
    const h = ownerHtml();
    expect(h).not.toContain("REVERSAL:");
    expect(h).not.toMatch(/Payment – Hill Country/);
    expect(h).toContain("11 transaction");
  });
  it("★★ the removed bill keeps its mark; the paid bill says when it was paid", () => {
    const h = ownerHtml();
    expect(h).toMatch(/↩ Removed · Mar 11, 2026/);
    expect(h).toMatch(/Paid · Feb 2, 2026/);
  });
  it("★★ the accountant still sees every entry", () => {
    const h = cockpitHtml();
    expect(h).toContain("REVERSAL:");
    expect(h).toMatch(/Hill Country Milling Co\./);
    expect(h).toContain("13 transaction");
    expect(h).not.toMatch(/Paid · Feb 2, 2026/);
  });
});

const bill = (id, amt, extra = {}) => ({ id, db_entry_id: id, date: "2026-01-05", amount: amt, gl_code: "5010", vendor: "V", ...extra });
const pay = (id, forId, amt, date = "2026-02-02", extra = {}) => ({ id, db_entry_id: id, date, amount: amt, gl_code: "2000", vendor: "Payment", payment_status: "paid", import_metadata: { kind: "ap_payment", payment_for: forId }, ...extra });

describe("C744 — ownerListView rules", () => {
  it("★★★ a PART-payment stays visible (the bill is still open)", () => {
    const inv = [bill("b1", 1000), pay("p1", "b1", 400)];
    const v = ownerListView(inv, inv);
    expect(v.rows.map((r) => r.id)).toEqual(["b1", "p1"]);
    expect(v.paidOn.size).toBe(0);
  });
  it("★★ two payments that together settle it both fold, and the date is the last one", () => {
    const inv = [bill("b1", 1000), pay("p1", "b1", 400, "2026-02-02"), pay("p2", "b1", 600, "2026-03-03")];
    const v = ownerListView(inv, inv);
    expect(v.rows.map((r) => r.id)).toEqual(["b1"]);
    expect(v.paidOn.get("b1")).toBe("2026-03-03");
  });
  it("★★ a payment for a bill not in the books (starting balances) stays visible", () => {
    const inv = [pay("p1", "zz", 400)];
    expect(ownerListView(inv, inv).rows.map((r) => r.id)).toEqual(["p1"]);
  });
  it("★★ a correction whose original isn't loaded stays visible; with its original, it folds", () => {
    const rev = { id: "r1", db_entry_id: "r1", date: "2026-03-11", amount: 145, gl_code: "6180", import_metadata: { kind: "reversal", reverses: "b9" } };
    expect(ownerListView([rev], [rev]).rows).toHaveLength(1);
    const inv = [bill("b9", 145), rev];
    expect(ownerListView(inv, inv).rows.map((r) => r.id)).toEqual(["b9"]);
  });
  it("★ a voided or deleted payment never folds anything", () => {
    for (const extra of [{ status: "voided" }, { deleted_at: "2026-02-03" }]) {
      const inv = [bill("b1", 1000), pay("p1", "b1", 1000, "2026-02-02", extra)];
      const v = ownerListView(inv, inv);
      expect(v.paidOn.size).toBe(0);
    }
  });
});

import { descAfterParty } from "../src/lib/txnPresent.js";
describe("C745 — the description doesn't repeat the name beside it (owner list)", () => {
  it("★★ drops a leading 'Name –' and keeps what follows", () => {
    expect(descAfterParty("Corner Market – ice, paid by card", "Corner Market")).toBe("ice, paid by card");
    expect(descAfterParty("Gusto Payroll — Mar 14, 2026 – Mar 27, 2026", "Gusto Payroll")).toBe("Mar 14, 2026 – Mar 27, 2026");
    expect(descAfterParty("sysco: produce", "Sysco")).toBe("produce");
  });
  it("★★ leaves anything else exactly as it is", () => {
    expect(descAfterParty("Payment – Hill Country Milling Co.", "Hill Country Milling Co.")).toBe("Payment – Hill Country Milling Co.");
    expect(descAfterParty("Corner Market Catering – sale", "Corner Market")).toBe("Corner Market Catering – sale");   // a longer name, not a separator
    expect(descAfterParty("", "X")).toBe("");
    expect(descAfterParty("Rent", "")).toBe("Rent");
  });
  it("★ nothing when the description was only the name", () => {
    expect(descAfterParty("Opening balances as of Jan 1, 2026", "Opening balances as of Jan 1, 2026")).toBe("");
  });
  it("★★ rendered: the owner's row reads the name once; the accountant's row is unchanged", () => {
    expect(ownerHtml()).not.toMatch(/Corner Market – ice/);
    expect(ownerHtml()).toContain(">ice, paid by card<");
    expect(cockpitHtml()).toMatch(/Corner Market – ice, paid by card/);
  });
});
