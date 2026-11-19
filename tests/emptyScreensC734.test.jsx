// ★ C734 — a brand-new company's screens: no warning about sign-off over figures that don't exist
// yet, and the empty list doesn't say "coded".
import { describe, it, expect } from "vitest";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import ReportsView from "../src/components/views/ReportsView.jsx";
import MoneyView from "../src/components/views/MoneyView.jsx";
import { CLIENT_VIEW_IDS } from "../src/lib/nav.js";

const owner = { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS };
const empty = { navSeat: owner, companyDataLoaded: true, invoices: [], filteredInvoices: [], ownerTrust: null, signoffsLoadOk: true, reviewedThrough: null };

describe("a brand-new company's screens", () => {
  it("★ Reports: no 'not signed off' line before anything is recorded — and it's back once there is", () => {
    const none = renderViewHtml(ReportsView, { ...POPULATED, ...(VIEW_CONTEXT["ReportsView.jsx"] || {}), ...empty });
    expect(none).not.toContain("data-attestation");
    // C740 — the owner never sees sign-off wording (their months show instead); the reviewer's seat still does
    const ownerSome = renderViewHtml(ReportsView, { ...POPULATED, ...(VIEW_CONTEXT["ReportsView.jsx"] || {}), navSeat: owner, companyDataLoaded: true, signoffsLoadOk: true, reviewedThrough: null });
    expect(ownerSome).not.toContain("data-attestation");
    // C761 — the owner's line about matching the bank reads after loading (absent in a static render)
    const cpa = { seat: "reviewer", isReviewerSeat: true, sections: [], viewIds: [] };
    const some = renderViewHtml(ReportsView, { ...POPULATED, ...(VIEW_CONTEXT["ReportsView.jsx"] || {}), navSeat: cpa, companyDataLoaded: true, signoffsLoadOk: true, reviewedThrough: null });
    expect(some).toContain("data-attestation");
    expect(some).toContain("No month has been signed off yet");
  });
  it("Money's empty list: 'sorted into the right category', not 'fully coded'", () => {
    const h = renderViewHtml(MoneyView, { ...POPULATED, ...(VIEW_CONTEXT["MoneyView.jsx"] || {}), ...empty, contacts: [], docLibrary: [] });
    expect(h).toContain("already sorted into the right category");
    expect(h).not.toContain("fully coded");
  });
});
