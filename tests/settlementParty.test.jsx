import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { renderViewHtml } from "./helpers/renderView.jsx";
import { POPULATED, INVOICES } from "./helpers/populatedFixture.js";
import { CLIENT_VIEW_IDS } from "../src/lib/nav.js";
import BooksView from "../src/components/views/BooksView.jsx";
import { displayParty } from "../src/lib/txnPresent.js";

// C539 — a settlement's `vendor` is the literal word "Payment" (its description is "Payment –
// Vendor"; the flatten's vendor is the left half), and the Transactions list, the detail panel and
// Home's feed all printed it, with a "P" avatar. The party is the bill the settlement links.
const text = (h) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
describe("C539", () => {
  const pay = INVOICES.find((r) => r.id === "i9");
  it("the shape under test: the fixture's payment row is vendored 'Payment'", () => {
    expect(pay.vendor).toBe("Payment");
  });
  it("displayParty names the bill's vendor; falls back to the description's right half; leaves other rows alone", () => {
    expect(displayParty(pay, INVOICES)).toBe("Hill Country Milling Co.");
    expect(displayParty({ ...pay, import_metadata: { kind: "ap_payment", payment_for: "nope" } }, INVOICES)).toBe("Hill Country Milling Co.");   // from "Payment – Hill Country Milling Co."
    expect(displayParty(INVOICES.find((r) => r.id === "i2"), INVOICES)).toBe("Hill Country Milling");
  });
  it("the Transactions list shows the payment under the supplier's name, never 'Payment'", () => {
    const navSeat = { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS };
    const t = text(renderViewHtml(BooksView, { ...POPULATED, navSeat, companyDataLoaded: true }));
    const i = t.indexOf("Payment – Hill Country Milling Co.");
    expect(i).toBeGreaterThan(-1);
    expect(t.slice(i - 80, i)).toContain("Hill Country Milling Co.");   // the vendor cell before the description
    expect(t.slice(i - 80, i)).not.toMatch(/\bP Payment\b/);
  });
  it("the panel's headline reads the party", () => {
    const src = fs.readFileSync("src/components/TransactionDetailPanel.jsx", "utf8").replace(/\/\/.*$/gm, "");
    expect(src).toContain("const party = displayParty(sel, invoices);");
    expect(src).toContain("{party || \"—\"}");
  });
});

// C541 — the opening position listed "Cash −$10,000.00 · Paid": no P&L line, so the direction
// fell to "expense-shaped". A debit to an asset is money in, and the row is a starting balance.
import { classifyTxn, txnStatus } from "../src/lib/txnPresent.js";
import DashboardView from "../src/components/views/DashboardView.jsx";
import { VIEW_CONTEXT } from "./helpers/renderView.jsx";
describe("C541 — the opening entry", () => {
  const ob = INVOICES.find((r) => r.id === "i12");
  it("is money in and a 'Starting balance', not '−$10,000 · Paid'", () => {
    expect(ob.source).toBe("opening_balance");   // the shape under test
    const cls = classifyTxn(ob, { apCode: "2000", arCode: "1100" });
    expect(cls.inflow).toBe(true);
    expect(cls.opening).toBe(true);
    expect(txnStatus(ob, cls).label).toBe("Starting balance");
  });
  it("renders so on the list and on Home", () => {
    const navSeat = { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS };
    const list = text(renderViewHtml(BooksView, { ...POPULATED, navSeat, companyDataLoaded: true }));
    expect(list).toMatch(/1000 Cash \+\$10,000\.00 Starting balance/);
    const home = text(renderViewHtml(DashboardView, { ...POPULATED, ...VIEW_CONTEXT["DashboardView.jsx"], navSeat, companyDataLoaded: true }));
    expect(home).toMatch(/🏁 Starting balances recorded[^🧾💰]*\+\$10,000\.00/);
    expect(home).not.toContain("Opening balances as of 2026-01-01 — Cash");
  });
  it("a transfer between two asset accounts is in when cash is debited, out when credited", () => {
    const inn = { id: "t1", vendor: "Transfer", gl_code: "1000", gl_name: "Cash", secondary_gl_code: "1050", debit_credit: "debit", source: "manual" };
    const out = { ...inn, debit_credit: "credit" };
    expect(classifyTxn(inn, {}).inflow).toBe(true);
    expect(classifyTxn(out, {}).inflow).toBe(false);
  });
});
