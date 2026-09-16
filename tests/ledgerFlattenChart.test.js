import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../src/lib/constants.js";

// ═════════════════════════════════════════════════════════════════════════════
// C505 — THE LEDGER WAS FLATTENED AGAINST WHATEVER CHART THE CLOSURE SAW WHEN THE FETCH
// RESOLVED — the BUILT-IN one while the company's own was still loading. `ar_amount` (the
// receivable incl. tax) is stamped by finding the company's `accounts_receivable` role, so a
// company whose A/R is numbered anything but 1100 got no `ar_amount` on any taxed invoice:
// every one read ex-tax on Money owed to you, the Customers screen and the chat, until a
// reload happened to order the two reads the other way. `loadAllData` waits for the chart
// (briefly, as the writers do since C461) and reads it through a ref.
// ═════════════════════════════════════════════════════════════════════════════
const chart = [
  { code: "1150", name: "Accounts Receivable", category: "Assets", system_role: "accounts_receivable" },
  { code: "2350", name: "Sales Tax Payable", category: "Liabilities" }, { code: "4000", name: "Sales", category: "Revenue" },
];
const acct = (code) => ({ code, name: chart.find((a) => a.code === code)?.name });
const entry = { id: "s1", entry_date: "2026-09-04", description: "Acme – catering", status: "posted", deleted_at: null, source: "ar_invoice", payment_status: "unpaid",
  journal_entry_lines: [{ id: "l0", debit: 1299, credit: 0, accounts: acct("1150") }, { id: "l1", debit: 0, credit: 1200, accounts: acct("4000") }, { id: "l2", debit: 0, credit: 99, accounts: acct("2350") }] };

describe("C505", () => {
  it("demonstrated: against the built-in chart a renumbered A/R stamps no ar_amount; against the company's chart it does", () => {
    const wrong = flattenJournalEntries([entry], DEFAULT_CHART_OF_ACCOUNTS).find((r) => r.gl_code === "4000");
    expect(wrong.ar_amount).toBeUndefined();
    const right = flattenJournalEntries([entry], chart).find((r) => r.gl_code === "4000");
    expect(right.ar_amount).toBe(1299);
  });
  it("loadAllData waits for the chart and reads it through the ref before flattening", () => {
    const src = fs.readFileSync("src/App.jsx", "utf8").replace(/^[ \t]*\/\/.*$/gm, "");
    const i = src.indexOf("mapped = await fetchLedger(supabase, cid, liveChartRef.current.length ? liveChartRef.current : CHART_OF_ACCOUNTS);");
    expect(i).toBeGreaterThan(-1);
    const j = src.lastIndexOf("await waitForChart();", i);
    expect(j).toBeGreaterThan(-1);
    expect(i - j).toBeLessThan(200);
    expect(src).not.toMatch(/mapped = await fetchLedger\(supabase, cid, CHART_OF_ACCOUNTS\)/);
  });
});
