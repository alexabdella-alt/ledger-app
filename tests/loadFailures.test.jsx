import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { settledFailures, loadFailedCopy } from "../src/lib/loadFailures.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import VendorsView from "../src/components/views/VendorsView.jsx";
import CustomersView from "../src/components/views/CustomersView.jsx";
import DocsView from "../src/components/views/DocsView.jsx";
import RulesView from "../src/components/views/RulesView.jsx";
import RecurringView from "../src/components/views/RecurringView.jsx";
import AuditView from "../src/components/views/AuditView.jsx";
import SendInvoiceView from "../src/components/views/SendInvoiceView.jsx";

// ═════════════════════════════════════════════════════════════════════════════
// C409 — A FAILED TABLE READ NO LONGER RENDERS AS "NO X YET".
//
// `loadAllData` settles twelve secondary reads; a failed one became `{}` and its screen
// took the empty-state branch (C277 kept that on purpose). So a Vendors screen over a
// failed `contacts` read said "No vendors yet" — O98 on every records screen, the shape
// C250 closed on the Team screen alone. The failures are recorded now (`loadFailures`)
// and each screen says it could not check instead.
// ═════════════════════════════════════════════════════════════════════════════
const NAMES = ["contacts", "vendor_rules", "documents"];

describe("settledFailures", () => {
  it("names a rejected read AND a fulfilled read carrying PostgREST's error", () => {
    const settled = [
      { status: "rejected", reason: new Error("network down") },
      { status: "fulfilled", value: { data: null, error: { message: "column x does not exist" } } },
      { status: "fulfilled", value: { data: [], error: null } },
    ];
    expect(settledFailures(settled, NAMES)).toEqual({ contacts: "network down", vendor_rules: "column x does not exist" });
  });
  it("an empty successful read is NOT a failure — that is the genuine empty state", () => {
    expect(settledFailures([{ status: "fulfilled", value: { data: [], error: null } }], ["documents"])).toEqual({});
  });
  it("the sentence says both halves — could not check, and not a confirmation of absence — in the owner's words", () => {
    const t = loadFailedCopy("suppliers");
    expect(t).toMatch(/couldn't load your suppliers/);
    expect(t).toMatch(/isn't a confirmation that there are none/);
    expect(containsOwnerJargon(t)).toBe(false);
  });
});

const SCREENS = [
  ["VendorsView", VendorsView, "contacts", /No vendors yet/],
  ["CustomersView", CustomersView, "contacts", /No customers yet/],
  ["DocsView", DocsView, "documents", /No documents yet/],
  ["RulesView", RulesView, "vendor_rules", /No rules yet/],
  ["RecurringView", RecurringView, "recurring_transactions", /No recurring transactions yet/],
  ["AuditView", AuditView, "audit_log", /No activity recorded yet/],
  ["SendInvoiceView", SendInvoiceView, "ar_invoices", /No invoices yet/],
];
const ctxFor = (name, extra) => ({ ...(VIEW_CONTEXT[`${name}.jsx`] || {}), vendorsSelectedContact: null, customersEditingId: null, vendorSummary: [], companyDataLoaded: true, ...extra });

describe("★★ each records screen: a failed read shows the notice, a clean empty read shows the empty state", () => {
  for (const [name, Comp, table, emptyRe] of SCREENS) {
    it(`${name} over a failed ${table} read`, () => {
      const html = renderViewHtml(Comp, ctxFor(name, { loadFailures: { [table]: "boom" } }));
      expect(html).toContain(`data-load-failed="${table}"`);
      expect(html).toMatch(/isn(&#x27;|')t a confirmation that there are none/);
      expect(html).not.toMatch(emptyRe);
    });
    it(`${name} while the company is still loading shows a loading line, not the empty state (C428)`, () => {
      const html = renderViewHtml(Comp, ctxFor(name, { loadFailures: {}, companyDataLoaded: false }));
      expect(html).toContain("data-loading-list");
      expect(html).not.toMatch(emptyRe);
    });
    it(`${name} over a clean empty read keeps its empty state`, () => {
      const html = renderViewHtml(Comp, ctxFor(name, { loadFailures: {} }));
      expect(html).not.toContain("data-load-failed");
      expect(html).toMatch(emptyRe);
    });
  }
});

// C428 — three more screens that read the ledger rather than a secondary table
import BooksView from "../src/components/views/BooksView.jsx";
import ApView from "../src/components/views/ApView.jsx";
import ArView from "../src/components/views/ArView.jsx";
describe("★ ledger screens show a loading line while the company loads, not their empty state (C428)", () => {
  for (const [name, Comp, emptyRe] of [["BooksView", BooksView, /No transactions yet/], ["ApView", ApView, /No bills|no bills|all paid|Nothing to pay/i], ["ArView", ArView, /No revenue invoices yet/]]) {
    it(name, () => {
      const loading = renderViewHtml(Comp, ctxFor(name, { loadFailures: {}, companyDataLoaded: false, invoices: [], arView: "inbox" }));
      expect(loading).toContain("data-loading-list");
      expect(loading).not.toMatch(emptyRe);
      const loaded = renderViewHtml(Comp, ctxFor(name, { loadFailures: {}, companyDataLoaded: true, invoices: [], arView: "inbox" }));
      expect(loaded).not.toContain("data-loading-list");
    });
  }
});

describe("the wiring (source)", () => {
  const app = fs.readFileSync("src/App.jsx", "utf8");
  it("the settled reads are named in order, and the failures are recorded on the same pass", () => {
    const i = app.indexOf("const failures = settledFailures(settled, LOAD_TABLES);");
    expect(i).toBeGreaterThan(-1);
    expect(app.slice(i, i + 200)).toMatch(/setLoadFailures\(failures\)/);
    // the name list matches the reads, table for table
    const tables = app.match(/const LOAD_TABLES = \[([^\]]*)\]/)[1].match(/"([a-z_]+)"/g).map((t) => t.replace(/"/g, ""));
    const start = app.indexOf("const settled = await Promise.allSettled([");
    const block = app.slice(start, app.indexOf("]);", start));
    const reads = [...block.matchAll(/supabase\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
    expect(reads).toEqual(tables);
  });
  it("a company switch clears the record, and the context exports it", () => {
    const i = app.indexOf("const resetCompanyState = () => {");
    expect(i).toBeGreaterThan(-1);
    expect(app.slice(i, i + 800)).toMatch(/setLoadFailures\(\{\}\)/);
    expect(app).toMatch(/setFiledDeadlines, loadFailures,/);
  });
});
