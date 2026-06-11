import { describe, it, expect } from "vitest";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { liveEntries, isLiveEntry } from "../src/lib/reports.js";
import { glPLType } from "../src/lib/gl.js";

// The transactions tab (BooksView) shows: invoices.filter(glPLType(gl_code) || type∈{expense,revenue}).
// This mirrors that predicate so the test guards the actual list the user sees.
const showsInTransactionsTab = (i) => !!(glPLType(i.gl_code) || i.type === "expense" || i.type === "revenue");

// A freshly inserted journal entry as it comes back from Supabase (loadAllData path):
// minimal fields — no payment_status, no approval_status, status 'posted', not deleted.
const freshDbEntry = (over = {}) => ({
  id: "je-fresh", entry_date: "2026-06-10", description: "Acme Co – Invoice #555",
  source: "universal_upload", status: "posted", deleted_at: null, created_at: "2026-06-10T10:00:00Z",
  journal_entry_lines: [
    { debit: 250, credit: 0, accounts: { code: "6500", name: "Technology & Software" } },
    { debit: 0, credit: 250, accounts: { code: "2000", name: "Accounts Payable" } },
  ],
  ...over,
});

describe("a freshly booked entry appears in the live transactions list", () => {
  it("flattens to a live, displayable row (the loadAllData path)", () => {
    const [row] = flattenJournalEntries([freshDbEntry()]);
    expect(row.status).toBe("booked");
    expect(row.gl_code).toBe("6500");
    expect(isLiveEntry(row)).toBe(true);
    expect(liveEntries([row])).toHaveLength(1);
    expect(showsInTransactionsTab(row)).toBe(true);
  });

  it("includes entries with absent / default / review-state status fields", () => {
    // The in-session optimistic shape (processUploadItem) and review-flagged entries.
    const shapes = [
      { id: "a", status: "booked", gl_code: "6500", type: "expense" },                 // auto-booked
      { id: "b", status: undefined, gl_code: "6500", type: "expense" },                // status absent
      { id: "c", status: "booked", gl_code: "6500", type: "expense", approval_status: "flagged" },
      { id: "d", status: "booked", gl_code: "6500", type: "expense", approval_status: "pending_approval" },
      { id: "e", status: "pending", gl_code: "4000", type: "revenue" },                // pending review
      { id: "f", status: "booked", gl_code: "6500", type: "expense", source: "qbo_import" },
      { id: "g", status: "booked", gl_code: "6500", type: "expense", payment_status: undefined },
    ];
    for (const s of shapes) {
      expect(isLiveEntry(s)).toBe(true);
      expect(liveEntries([s])).toHaveLength(1);
      expect(showsInTransactionsTab(s)).toBe(true);
    }
  });

  it("still excludes only voided and soft-deleted entries", () => {
    expect(isLiveEntry({ id: "v", status: "voided", gl_code: "6500", type: "expense" })).toBe(false);
    expect(isLiveEntry({ id: "x", status: "deleted", gl_code: "6500", type: "expense" })).toBe(false);
    expect(isLiveEntry({ id: "y", status: "booked", gl_code: "6500", type: "expense", deleted_at: "2026-01-01T00:00:00Z" })).toBe(false);
    expect(liveEntries([
      { id: "ok", status: "booked", gl_code: "6500", type: "expense" },
      { id: "v", status: "voided", gl_code: "6500", type: "expense" },
    ])).toHaveLength(1);
  });
});
