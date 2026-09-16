// C523 — the upload-time duplicate check reads ENTRIES, not the expanded rows. Over rows, a
// weekly two-line bill (three rows a week at three amounts) could never read as a flat-fee rhythm,
// so it was offered as a duplicate every week; and the by-number match returned a LINE.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { findDuplicate, perEntry } from "../src/lib/insights.js";
import { duplicateIsExpectedRhythm } from "../src/lib/recurringVendor.js";

const chart = [
  { code: "2000", name: "Accounts Payable", category: "Liabilities", system_role: "accounts_payable" },
  { code: "5010", name: "Food Cost", category: "Expenses" }, { code: "5030", name: "Freight", category: "Expenses" },
];
const acct = (code) => ({ code, name: chart.find(a => a.code === code)?.name });
const je = (id, date, lines, extra = {}) => ({ id, entry_date: date, description: "Bluebonnet – linen + delivery", status: "posted", deleted_at: null, source: "universal_upload", payment_status: "paid",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: acct(l.code) })), ...extra });
const weekly = (id, date) => je(id, date, [{ code: "5010", debit: 130 }, { code: "5030", debit: 15 }, { code: "2000", credit: 145 }], { reference_number: `BLS-${id}` });
const rows = flattenJournalEntries(["07-06", "07-13", "07-20", "07-27", "08-03", "08-10"].map((d, i) => weekly(`w${i}`, `2026-${d}`)), chart);
const arriving = { vendor: "Bluebonnet", amount: 145, date: "2026-08-17", invoice_number: "BLS-new" };

describe("C523", () => {
  it("THE DEFECT, DEMONSTRATED: over the expanded rows the weekly two-line bill is a duplicate every week", () => {
    const dup = findDuplicate(arriving, rows);
    expect(dup).toBeTruthy();   // matched by accident — the A/P leg row carries the $145
    const vendorRows = rows.filter(r => /bluebonnet/i.test(r.vendor));
    expect(duplicateIsExpectedRhythm(arriving, dup, vendorRows)).toBe(false);   // three rows a week at 130/15/145 is not flat
  });
  it("over entries the same bill is the vendor's rhythm, and the match is the entry at its total", () => {
    const entries = perEntry(rows);
    const dup = findDuplicate(arriving, entries);
    expect(dup).toBeTruthy();
    expect(dup.amount).toBe(145);
    expect(dup._lineCount).toBe(3);
    expect(duplicateIsExpectedRhythm(arriving, dup, entries.filter(r => /bluebonnet/i.test(r.vendor)))).toBe(true);
  });
  it("a by-number match resolves to the entry, not one of its lines — and a multi-line bill's number is read back at all", () => {
    // C478 read `reference_number` back on the simple branch only; the expanded branch never
    // carried it, so a re-dropped multi-line invoice was never caught by its number.
    expect(rows.filter(r => r.invoice_number === "BLS-w3").length).toBe(3);
    // and the other per-entry fields the simple branch carried alone: the payment reference and notes
    const paid = flattenJournalEntries([weekly("pd", "2026-08-24")].map(e => ({ ...e, payment_reference: "ACH 4471", payment_notes: "paid Friday" })), chart);
    expect(paid.every(r => r.payment_reference === "ACH 4471" && r.payment_notes === "paid Friday")).toBe(true);
    const entries = perEntry(rows);
    const hit = entries.find(ex => ex.invoice_number === "BLS-w3");
    expect(hit.amount).toBe(145);
  });
  it("App.jsx's upload path reads perEntry for both checks", () => {
    const src = fs.readFileSync("src/App.jsx", "utf8").replace(/\/\/.*$/gm, "");
    const at = src.indexOf("const ledgerEntries = perEntry(invoices);");
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf("const dupExisting", at));
    expect(block).toContain("ledgerEntries.find(ex =>");
    expect(block).toContain("findDuplicate(invoice, ledgerEntries)");
    expect(block).toContain("ledgerEntries.filter(x => normVendorName(x?.vendor) === dupVendorKey)");
    expect(block).not.toMatch(/\binvoices\.(find|filter)\(/);
  });
});
