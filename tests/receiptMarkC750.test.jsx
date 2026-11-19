// ★ C750 — RECEIPTS YOU CAN SEE, AND ADD FROM A PHONE; DOCUMENTS AND PEOPLE AT THE TOP OF MONEY.
// (1) a 📎 on every list row whose receipt/bill is saved, by the SAME rule the detail panel uses;
// (2) the "no receipt yet" box gets a phone camera button, and a phone photo / iPhone HEIC is made
//     readable before the guard (as Home does, C736);
// (3) Documents · Vendors · Customers are cards at the top of Money, not chips under the list.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import MoneyView from "../src/components/views/MoneyView.jsx";
import BooksView from "../src/components/views/BooksView.jsx";
import { CLIENT_VIEW_IDS } from "../src/lib/nav.js";
import { linkedDocIds, hasSourceDoc, sourceDocFor, RECEIPT_MARK_LABEL, RECEIPT_ADD_COPY } from "../src/lib/sourceDoc.js";
import { moneyLinks } from "../src/lib/moneyPage.js";

const owner = { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS };
const clean = (h) => h.replace(/&#x27;/g, "'").replace(/<!-- -->/g, "");
const money = (extra = {}) => clean(renderViewHtml(MoneyView, { ...POPULATED, ...(VIEW_CONTEXT["MoneyView.jsx"] || {}), navSeat: owner, companyDataLoaded: true, ...extra }));
const books = (extra = {}) => clean(renderViewHtml(BooksView, { ...POPULATED, ...(VIEW_CONTEXT["BooksView.jsx"] || {}), navSeat: { seat: "reviewer", isReviewerSeat: true, sections: [] }, companyDataLoaded: true, ...extra }));
const count = (h, s) => h.split(s).length - 1;

describe("C750 — which entries have a receipt", () => {
  it("★★ linked to either the row id or its entry id; nothing else", () => {
    const ids = linkedDocIds([{ linked_invoice_id: "je-1" }, { linked_invoice_id: null }, { linked_invoice_id: "" }, {}]);
    expect([...ids]).toEqual(["je-1"]);
    expect(hasSourceDoc({ id: "je-1" }, ids)).toBe(true);
    expect(hasSourceDoc({ id: "je-1_2", db_entry_id: "je-1" }, ids)).toBe(true);
    expect(hasSourceDoc({ id: "je-2", db_entry_id: "je-2" }, ids)).toBe(false);
    expect(hasSourceDoc({ id: "je-1" }, new Set())).toBe(false);
    expect(hasSourceDoc({}, ids)).toBe(false);
  });
  it("★ numbers and strings match (ids arrive both ways)", () => {
    expect(hasSourceDoc({ id: 7 }, linkedDocIds([{ linked_invoice_id: "7" }]))).toBe(true);
    expect(sourceDocFor({ id: "7" }, [{ id: "d", linked_invoice_id: 7 }])?.id).toBe("d");
  });
  it("★★★ the list and the detail panel agree, row by row", () => {
    const docs = [{ id: "d1", linked_invoice_id: "a" }, { id: "d2", linked_invoice_id: "c" }];
    const ids = linkedDocIds(docs);
    for (const inv of [{ id: "a" }, { id: "b" }, { id: "c_1", db_entry_id: "c" }, { id: "x", db_entry_id: "y" }])
      expect(hasSourceDoc(inv, ids)).toBe(!!sourceDocFor(inv, docs));
  });
});

describe("C750 — the 📎 on the list, rendered", () => {
  it("★★ exactly the one bill with a saved document carries the mark (owner and accountant)", () => {
    for (const h of [money(), books()]) {
      expect(count(h, "data-receipt-mark")).toBe(1);
      const row = h.slice(h.lastIndexOf("<tr", h.indexOf("data-receipt-mark")), h.indexOf("data-receipt-mark"));
      expect(row).toContain("Hill Country Milling Co.");
      expect(h).toContain(`aria-label="${RECEIPT_MARK_LABEL}"`);
    }
  });
  it("★ no saved documents → no marks", () => {
    expect(count(money({ docLibrary: [] }), "data-receipt-mark")).toBe(0);
  });
});

describe("C750 — adding a receipt to an entry, from a phone", () => {
  const panel = readFileSync(new URL("../src/components/TransactionDetailPanel.jsx", import.meta.url), "utf8");
  const fn = panel.slice(panel.indexOf("const handleSourceUpload = async"), panel.indexOf("const doRecode = async"));
  it("★★ a phone photo is made readable BEFORE the size/type guard", () => {
    const shrink = fn.indexOf("file = await shrinkImageFile(file)");
    expect(shrink).toBeGreaterThan(0);
    expect(shrink).toBeLessThan(fn.indexOf("validateUpload(file"));
    expect(fn).toContain("HEIC_UNREADABLE_COPY");
  });
  it("★★ a camera input (capture) and a file input that takes HEIC; the camera button is phone-only", () => {
    expect(panel).toMatch(/ref=\{srcCameraRef\} type="file" accept="image\/\*" capture="environment"/);
    expect(panel).toMatch(/ref=\{srcFileRef\} type="file" accept="[^"]*\.heic,\.heif"/);
    expect(panel).toMatch(/data-src-camera className="sc-phone-only"/);
  });
  it("★★ the phone-only rule lives in the SHARED stylesheet (it was only inside Home's own styles)", () => {
    const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.sc-phone-only \{ display: none !important; \}/);
    expect(css).toMatch(/@media \(pointer: coarse\) \{ \.sc-phone-only \{ display: flex !important; \} \}/);
  });
  it("★ owner words", () => {
    expect(RECEIPT_ADD_COPY.none).not.toMatch(/source document/i);
    expect(panel).not.toContain("No source document attached.");
  });
});

describe("C750 — documents and people at the top of Money", () => {
  it("★★ Documents first, each with a line saying what's behind it", () => {
    const l = moneyLinks({ contacts: [{ type: "vendor" }, { type: "both" }], docs: [{}, {}] });
    expect(l.map((x) => [x.view, x.count])).toEqual([["docs", 2], ["vendors", 2], ["customers", 1]]);
    for (const x of l) expect(x.sub).toBeTruthy();
  });
  it("★★★ rendered above the figures and above the list — not after it", () => {
    const h = money();
    const links = h.indexOf('data-money-link="docs"');
    expect(links).toBeGreaterThan(0);
    expect(links).toBeLessThan(h.indexOf("data-money-summary"));
    expect(links).toBeLessThan(h.indexOf("Hill Country Milling Co."));
    expect(h).not.toContain("Also here:");
    expect(h).toContain("Every receipt, bill and statement you've sent");
  });
});
