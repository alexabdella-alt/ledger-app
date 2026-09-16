import { describe, it, expect } from "vitest";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { computeVendorTotals } from "../src/lib/reports.js";
import { buildVendorSummary } from "../src/lib/vendorSummary.js";

// C506 — a bill with two expense lines counted as TWO transactions on the Vendors tab and
// the By Vendor report (the total was right; the count was per flattened row).
const chart = [{ code: "2000", name: "Accounts Payable", category: "Liabilities", system_role: "accounts_payable" }, { code: "5010", name: "Food Cost", category: "Expenses" }, { code: "5030", name: "Freight", category: "Expenses" }];
const acct = (code) => ({ code, name: chart.find((a) => a.code === code)?.name });
const je = (id, date, description, lines) => ({ id, entry_date: date, description, status: "posted", deleted_at: null, source: "universal_upload", payment_status: "unpaid",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: acct(l.code) })) });
const rows = flattenJournalEntries([
  je("b1", "2026-09-02", "Sysco – produce + freight", [{ code: "5010", debit: 500 }, { code: "5030", debit: 20 }, { code: "2000", credit: 520 }]),
  je("b2", "2026-09-03", "Sysco – cheese", [{ code: "5010", debit: 120 }, { code: "2000", credit: 120 }]),
], chart);

describe("C506", () => {
  it("two bills are two transactions, however many lines they carry, and the total still sums every line", () => {
    const vt = computeVendorTotals(rows, { from: "2026-09-01", to: "2026-09-30" });
    expect(vt.map((v) => [v.total, v.count])).toEqual([[640, 2]]);
    expect(vt[0]._entries).toBeUndefined();
    const vs = buildVendorSummary(rows);
    expect(vs.map((v) => [v.total, v.count])).toEqual([[640, 2]]);
    expect(vs[0]._entries).toBeUndefined();
  });
});
