import { describe, it, expect } from "vitest";
import { buildVendorSummary, isVendorSpend } from "../src/lib/vendorSummary.js";
import { flattenJournalEntries } from "../src/lib/ledger.js";

// ═════════════════════════════════════════════════════════════════════════════
// THE VENDORS TAB — flagged DEMO-LETHAL, and the numbers were wrong as well as the list.
//
// It was keyed over EVERY flattened ledger row with no filter, so the system opening-
// balance entry became a vendor named "Opening balances as of 2026-01-01", a revenue
// deposit became a "Toast POS" vendor, and every bill's PAYMENT was counted as a second
// piece of spend.
//
// ★ RUN THROUGH THE REAL `flattenJournalEntries`, because the population is whatever that
// function emits — a test on hand-built rows would prove only that the filter filters.
// ═════════════════════════════════════════════════════════════════════════════

const entry = (id, date, desc, lines, over = {}) => ({
  id, entry_date: date, description: desc, source: over.source || "manual",
  status: "posted", deleted_at: null, created_at: `${date}T10:00:00Z`,
  import_metadata: over.import_metadata || null,
  journal_entry_lines: lines.map(l => ({ debit: l.debit || 0, credit: l.credit || 0, accounts: { code: l.code, name: l.name || l.code } })),
});

// The real Franklin Ave shape: a bill, then its payment.
const bill    = entry("b1", "2026-01-12", "Hill Country Milling Co. – Specialty flour and freight",
                      [{ code: "5000", name: "Cost of Goods Sold", debit: 824.60 }, { code: "2000", name: "Accounts Payable", credit: 824.60 }]);
const payment = entry("p1", "2026-01-14", "Hill Country Milling Co. – Payment – Hill Country Milling Co.",
                      [{ code: "2000", name: "Accounts Payable", debit: 824.60 }, { code: "1000", name: "Cash", credit: 824.60 }]);
const opening = entry("o1", "2026-01-01", "Opening balances as of 2026-01-01",
                      [{ code: "1000", name: "Cash", debit: 5000 }, { code: "3400", name: "Opening Balance Equity", credit: 5000 }],
                      { source: "opening_balance" });
const deposit = entry("d1", "2026-01-20", "Toast POS – DEPOSIT TOAST POS",
                      [{ code: "1000", name: "Cash", debit: 1200 }, { code: "4000", name: "Product Revenue", credit: 1200 }]);

describe("★★ the Vendors tab shows vendors, and only vendors", () => {
  const rows = flattenJournalEntries([bill, payment, opening, deposit]);
  const summary = buildVendorSummary(rows);
  const names = summary.map(v => v.name);

  it("THE LIVE LEAK: the opening-balance entry is not a vendor", () => {
    expect(names.some(n => /Opening balances/i.test(n))).toBe(false);
  });

  it("THE LIVE LEAK: a revenue deposit is not a vendor", () => {
    // Money coming IN is not a vendor payment, however the description reads.
    expect(names.some(n => /Toast/i.test(n))).toBe(false);
  });

  it("★★ AND THE NUMBERS: a paid bill counts ONCE, not as spend plus its own settlement", () => {
    // This is the half that makes the tab WRONG rather than untidy. Both the bill and its
    // payment carry the same vendor name and the same amount, so an unfiltered sum showed
    // an $824.60 purchase as $1,649.20.
    expect(summary).toHaveLength(1);
    expect(summary[0].name).toMatch(/Hill Country/);
    expect(summary[0].total).toBe(824.60);
    expect(summary[0].count).toBe(1);
  });

  it("★ a direct-to-cash expense still counts — it never touched Accounts Payable", () => {
    const direct = entry("x1", "2026-02-01", "Alamo Fire & Safety LLC – inspection",
                         [{ code: "6250", name: "Repairs", debit: 425 }, { code: "1000", name: "Cash", credit: 425 }]);
    const s = buildVendorSummary(flattenJournalEntries([direct]));
    expect(s).toHaveLength(1);
    expect(s[0].total).toBe(425);
  });

  it("★ a removed bill's correction NETS IT OUT rather than adding to spend", () => {
    // The correction is a credit to the same expense account and groups under the same
    // vendor key (O125), so the vendor's spend returns to zero — which is what happened.
    const rev = entry("r1", "2026-01-20", "REVERSAL: Hill Country Milling Co. – Specialty flour and freight — Voided",
                      [{ code: "5000", name: "Cost of Goods Sold", credit: 824.60 }, { code: "2000", name: "Accounts Payable", debit: 824.60 }],
                      { import_metadata: { kind: "reversal", reverses: "b1" } });
    const s = buildVendorSummary(flattenJournalEntries([bill, rev]));
    expect(s).toHaveLength(1);
    expect(s[0].total).toBe(0);
  });

  it("groups spellings together and labels with the most recent one", () => {
    const later = entry("b2", "2026-03-02", "Hill Country Milling Co – Pizza flour",
                        [{ code: "5000", name: "Cost of Goods Sold", debit: 100 }, { code: "2000", name: "AP", credit: 100 }]);
    const s = buildVendorSummary(flattenJournalEntries([bill, later]));
    expect(s).toHaveLength(1);
    expect(s[0].total).toBe(924.60);
    expect(s[0].name).toBe("Hill Country Milling Co");   // the later spelling
  });

  it("the predicate is one rule, not a list of special cases", () => {
    expect(isVendorSpend({ gl_code: "5000", amount: 1 })).toBe(true);
    expect(isVendorSpend({ gl_code: "4000", amount: 1 })).toBe(false);   // revenue
    expect(isVendorSpend({ gl_code: "2000", amount: 1 })).toBe(false);   // payment
    expect(isVendorSpend({ gl_code: "1000", amount: 1 })).toBe(false);   // cash / transfer
    expect(isVendorSpend({ gl_code: "5000", source: "opening_balance" })).toBe(false);
    expect(isVendorSpend({ gl_code: "5000", status: "voided" })).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ★★ C347 — "VIEW ALL TRANSACTIONS FOR X" OPENED ONTO THE UNFILTERED LIST.
// C315 repointed DetailView's button at BooksView + `vendorFilter`; BooksView never read the
// filter, and its only reader (InvoicesView) was deleted in C335. `filteredInvoices` sat on
// the context, computed on every render, consumed by nothing. The scoper is a lib function
// now so the resolution can be checked, and BooksView is rendered with it below.
// ═════════════════════════════════════════════════════════════════════════════
import { scopeInvoicesToVendor } from "../src/lib/vendorSummary.js";
import { INVOICES, POPULATED } from "./helpers/populatedFixture.js";
import { renderViewHtml } from "./helpers/renderView.jsx";
import BooksView from "../src/components/views/BooksView.jsx";

describe("★★ C347 — scoping the list to one supplier", () => {
  const summary = buildVendorSummary(INVOICES);

  it("★ the ROW's spelling finds the whole group, even when the Vendors tab labels it otherwise", () => {
    // The group's label is the most RECENT spelling — "Hill Country Milling" (March). The
    // detail page of the January row sets the filter to "Hill Country Milling Co.", which is
    // NOT the label. Resolved by the row's KEY, both spellings come back — and the same key
    // the Vendors tab groups by, so the two screens agree about who X is.
    expect(summary.find(v => v.key === "hill country milling").name).toBe("Hill Country Milling");
    const scoped = scopeInvoicesToVendor(INVOICES, "Hill Country Milling Co.");
    expect(scoped.map(i => i.id).sort()).toEqual(["i1", "i2"]);
    // …and by the label itself.
    expect(scopeInvoicesToVendor(INVOICES, "Hill Country Milling").map(i => i.id).sort()).toEqual(["i1", "i2"]);
  });

  it("a supplier no row carries scopes to NOTHING, never to everything", () => {
    expect(scopeInvoicesToVendor(INVOICES, "Sysco")).toEqual([]);
  });

  it("'all' is the whole list", () => {
    expect(scopeInvoicesToVendor(INVOICES, "all")).toHaveLength(INVOICES.length);
  });

  it("★★ RENDERED: the Transactions screen shows only that supplier, names the scope, and offers the way out", () => {
    const filteredInvoices = scopeInvoicesToVendor(INVOICES, "Hill Country Milling Co.");
    const html = renderViewHtml(BooksView, { ...POPULATED, vendorFilter: "Hill Country Milling Co.", filteredInvoices });
    expect(html).toContain("Hill Country Milling Co.");
    expect(html).toContain("Hill Country Milling");
    expect(html).not.toContain("Bluebonnet");
    expect(html).not.toContain("Franklin Ave");
    expect(html).toContain("Showing only");
    expect(html).toContain("Show all suppliers");
    // The mutation this exists for — BooksView reading `invoices` instead of the scope —
    // puts Bluebonnet back on the page.
  });

  it("★ RENDERED: with no scope the list is whole and the scope chip is absent", () => {
    const html = renderViewHtml(BooksView, { ...POPULATED, vendorFilter: "all", filteredInvoices: INVOICES });
    expect(html).toContain("Bluebonnet");
    expect(html).not.toContain("Showing only");
  });

  it("★ a scope that matches nothing says 'No matching transactions', not 'No transactions yet'", () => {
    const html = renderViewHtml(BooksView, { ...POPULATED, vendorFilter: "Sysco", filteredInvoices: [] });
    expect(html).toContain("No matching transactions");
    expect(html).not.toContain("No transactions yet");
  });
});

describe("★ C347 — the scope honours a confirmed alias (O111)", () => {
  it("both names come back when a person has said they are one supplier", async () => {
    const { buildAliasIndex } = await import("../src/lib/vendorAlias.js");
    const rows = [
      { id: "a", vendor: "Franklin Ave Properties", vendor_key: "franklin ave properties", amount: 2400, date: "2026-03-01", gl_code: "6100" },
      { id: "b", vendor: "FRANKLIN AVE PROPERTIES LP RENT", vendor_key: "franklin ave properties rent", amount: 2400, date: "2026-02-01", gl_code: "6100" },
      { id: "c", vendor: "Bluebonnet Linen Service", vendor_key: "bluebonnet linen service", amount: 145, date: "2026-03-09", gl_code: "6180" },
    ];
    const idx = buildAliasIndex([{ id: "c1", name: "Franklin Ave Properties", aliases: ["FRANKLIN AVE PROPERTIES LP RENT"] }]);
    expect(scopeInvoicesToVendor(rows, "Franklin Ave Properties", idx).map(i => i.id).sort()).toEqual(["a", "b"]);
    // …and without the alias the two stay apart, which is the whole point of O111 being a
    // person's assertion rather than a guess.
    expect(scopeInvoicesToVendor(rows, "Franklin Ave Properties", null).map(i => i.id)).toEqual(["a"]);
  });
});
