import { describe, it, expect } from "vitest";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { renderViewHtml } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import { flaggedForReview } from "../src/lib/confidenceFlag.js";
import BooksView from "../src/components/views/BooksView.jsx";

// C530 — the Transactions list's "Needs Review" pill is the same judgement Review and Home make.
const chart = [
  { code: "1000", name: "Cash", category: "Assets", system_role: "cash" }, { code: "2000", name: "Accounts Payable", category: "Liabilities", system_role: "accounts_payable" },
  { code: "1100", name: "Accounts Receivable", category: "Assets", system_role: "accounts_receivable" }, { code: "5010", name: "Food Cost", category: "Expenses" },
];
const acct = (code) => ({ code, name: chart.find(a => a.code === code)?.name });
const je = (id, date, description, amount, conf) => ({ id, entry_date: date, description, status: "posted", deleted_at: null, source: "universal_upload", payment_status: "unpaid", ai_confidence: conf,
  journal_entry_lines: [{ id: `${id}-l0`, debit: amount, credit: 0, accounts: acct("5010") }, { id: `${id}-l1`, debit: 0, credit: amount, accounts: acct("2000") }] });
const rows = flattenJournalEntries([
  je("small", "2026-09-02", "Corner Market – ice", 5, 60),        // unsure but immaterial: NOT flagged by the shared rule
  je("big", "2026-09-03", "Sysco – produce", 3000, 72),           // uncertain (under 75) AND material: flagged
  je("sure", "2026-09-04", "Roma – cheese", 400, 96),             // fine
], chart);
const text = (h) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("C530", () => {
  it("the shared rule flags the $3,000 at 72% and not the $5 at 60%", () => {
    expect(flaggedForReview(rows).map(f => f.id)).toEqual(["big"]);
  });
  it("the Transactions list wears exactly one Needs Review pill, on the same entry", () => {
    const t = text(renderViewHtml(BooksView, { ...POPULATED, invoices: rows, companyDataLoaded: true, getAccountByRole: (r) => chart.find(a => a.system_role === r) || null }));
    expect((t.match(/Needs Review/g) || []).length).toBe(2);   // the filter pill + one row pill
    const i = t.indexOf("Sysco – produce");
    expect(t.slice(i, i + 200)).toContain("Needs Review");
    const j = t.indexOf("Corner Market – ice");
    expect(t.slice(j, j + 200)).not.toContain("Needs Review");
  });
});
