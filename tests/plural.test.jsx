import { describe, it, expect } from "vitest";
import { plural } from "../src/lib/format.js";
import { renderViewHtml } from "./helpers/renderView.jsx";
import CoaView from "../src/components/views/CoaView.jsx";
import AuditView from "../src/components/views/AuditView.jsx";

// C436 — "1 accounts", "1 events" on owner screens.
describe("plural", () => {
  it("agrees with the count, including an irregular plural", () => {
    expect(plural(1, "account")).toBe("1 account");
    expect(plural(0, "account")).toBe("0 accounts");
    expect(plural(3, "category", "categories")).toBe("3 categories");
    expect(plural(1, "category", "categories")).toBe("1 category");
  });
  it("the Categories and Audit trail screens agree with their counts", () => {
    const coa = renderViewHtml(CoaView, { accountsLoadOk: true, CHART_OF_ACCOUNTS: [{ code: "2000", name: "Accounts Payable", category: "Liabilities" }] }).replace(/<!-- -->/g, "");
    expect(coa).toMatch(/LIABILITIES — 1 account\b/);
    expect(coa).not.toMatch(/1 accounts/);
    const audit = renderViewHtml(AuditView, { auditLog: [{ id: 1, action: "invoice_booked", detail: "x", created_at: "2026-09-01T00:00:00Z" }], auditActionFilter: "all", auditSearch: "", companyDataLoaded: true, loadFailures: {} }).replace(/<!-- -->/g, "");
    expect(audit).toMatch(/\(1 event\)/);
    expect(audit).not.toMatch(/1 events/);
  });
});
