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
