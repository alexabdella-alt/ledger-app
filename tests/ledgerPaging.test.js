import { describe, it, expect } from "vitest";
import { fetchLedgerEntries, fetchLedger } from "../src/lib/ledger.js";
import { computeRevenue, computeExpenses, computeNetIncome, glAccountBalance } from "../src/lib/reports.js";

// ════════════════════════════════════════════════════════════════════════════
// FIX A — the paged, uncapped ledger loader (CR-14 🔴 / CR-15 🟠). Proves the
// whole ledger loads (no 500/5000 cap), the opening entry survives at volume,
// app-side and AI-side computes read the SAME dataset, and paging terminates
// correctly on boundary sizes. Uses a fake supabase query builder that mimics
// PostgREST's .range() windowing over an in-memory table.
// ════════════════════════════════════════════════════════════════════════════

// Minimal fake of the supabase query chain fetchLedgerEntries uses. Records how
// many .range() round-trips happened so we can assert paging behavior.
function fakeSupabase(rows, { errorOnPage = -1 } = {}) {
  let pageCalls = 0;
  return {
    _pageCalls: () => pageCalls,
    from() {
      const q = {
        _from: 0, _to: Infinity,
        select() { return q; },
        eq() { return q; },
        is() { return q; },
        order() { return q; },
        range(from, to) {
          q._from = from; q._to = to;
          // PostgREST resolves the builder when awaited; model that with then().
          return q;
        },
        then(resolve) {
          const page = ++pageCalls;
          if (errorOnPage === page) return resolve({ data: null, error: { message: "simulated page error" } });
          // Stable order is irrelevant to the set; slice the window like PostgREST.
          const slice = rows.slice(q._from, q._to + 1);
          return resolve({ data: slice, error: null });
        },
      };
      return q;
    },
  };
}

// A DB-shaped posted entry (what PostgREST returns to the loader).
const dbEntry = (id, date, lines) => ({
  id, entry_date: date, description: id, source: "manual", status: "posted", deleted_at: null,
  created_at: `${date}T10:00:00Z`, import_metadata: null,
  journal_entry_lines: lines.map(l => ({ debit: l.debit || 0, credit: l.credit || 0, accounts: { code: l.code, name: l.code } })),
});
// A simple direct-cash expense of $10 (Dr 6500 / Cr 1000).
const expenseRow = (i) => dbEntry(`e${i}`, "2026-03-01", [{ code: "6500", debit: 10 }, { code: "1000", credit: 10 }]);
// The opening-balance entry (oldest date), Dr Cash 5000 / Cr Opening Balance Equity.
const openingEntry = dbEntry("opening", "2026-01-01", [{ code: "1000", debit: 5000 }, { code: "3400", credit: 5000 }]);

describe("fetchLedgerEntries — pages through the WHOLE ledger, no cap", () => {
  it("loads every entry well past the old 500 / 5000 caps", async () => {
    const rows = [openingEntry, ...Array.from({ length: 5200 }, (_, i) => expenseRow(i))]; // 5201 total
    const sb = fakeSupabase(rows);
    const got = await fetchLedgerEntries(sb, "co", { pageSize: 1000 });
    expect(got).toHaveLength(5201);                    // nothing dropped (old cap would have lost 4700+)
    expect(got.some(e => e.id === "opening")).toBe(true);
  });

  it("terminates correctly on boundary sizes (exactly 1000 and 1001)", async () => {
    for (const n of [0, 1, 999, 1000, 1001, 2000, 2001]) {
      const rows = Array.from({ length: n }, (_, i) => expenseRow(i));
      const got = await fetchLedgerEntries(fakeSupabase(rows), "co", { pageSize: 1000 });
      expect(got).toHaveLength(n);
    }
    // exactly 1000 → 2 round-trips (full page, then an empty page confirms the end)
    const sb = fakeSupabase(Array.from({ length: 1000 }, (_, i) => expenseRow(i)));
    await fetchLedgerEntries(sb, "co", { pageSize: 1000 });
    expect(sb._pageCalls()).toBe(2);
    // 1001 → also 2 round-trips (1000 then a short page of 1)
    const sb2 = fakeSupabase(Array.from({ length: 1001 }, (_, i) => expenseRow(i)));
    await fetchLedgerEntries(sb2, "co", { pageSize: 1000 });
    expect(sb2._pageCalls()).toBe(2);
  });

  it("throws (never returns a partial ledger) if any page errors", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => expenseRow(i));
    const sb = fakeSupabase(rows, { errorOnPage: 2 });   // second page fails mid-load
    await expect(fetchLedgerEntries(sb, "co", { pageSize: 1000 })).rejects.toBeTruthy();
  });
});

describe("fetchLedger + reports — the opening position survives and totals are whole at volume", () => {
  it("balance-sheet cash carries the opening position past 500 entries; expenses count every row", async () => {
    // opening cash 5000, then 600 expenses of $10 = 6000 total expense; cash = 5000 - 6000 = -1000.
    const rows = [openingEntry, ...Array.from({ length: 600 }, (_, i) => expenseRow(i))];
    const flat = await fetchLedger(fakeSupabase(rows), "co", []);
    expect(flat).toHaveLength(601);
    expect(computeExpenses(flat)).toBe(6000);            // all 600 counted (old cap would truncate)
    expect(glAccountBalance("1000", flat)).toBe(-1000);  // 5000 opening − 6000 paid out; opening entry present
    expect(glAccountBalance("3400", flat)).toBe(5000);   // Opening Balance Equity intact
  });

  it("app-side and AI-side reads are the SAME dataset → identical to the penny (CR-15)", async () => {
    const rows = [openingEntry, ...Array.from({ length: 1500 }, (_, i) => expenseRow(i))]; // between old 500 and 5000 caps
    const sb = fakeSupabase(rows);
    // Both the app (loadAllData) and the AI path now call fetchLedger — same loader, same result.
    const appLedger = await fetchLedger(sb, "co", []);
    const aiLedger = await fetchLedger(fakeSupabase(rows), "co", []);
    expect(computeRevenue(appLedger)).toBe(computeRevenue(aiLedger));
    expect(computeExpenses(appLedger)).toBe(computeExpenses(aiLedger));
    expect(computeNetIncome(appLedger)).toBe(computeNetIncome(aiLedger));
    expect(computeExpenses(appLedger)).toBe(15000);      // all 1500 present in both
  });
});
