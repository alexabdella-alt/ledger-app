import { describe, it, expect } from "vitest";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import {
  computeExpenses, computeCategoryTotals, computeVendorTotals, computeBurnRate,
} from "../src/lib/reports.js";

// ════════════════════════════════════════════════════════════════════════════
// F-3 (external review): computeVendorTotals + computeBurnRate must walk BOTH
// legs of a simple row (like computeCategoryTotals), or an intra-P&L RECLASS
// (Dr 6200 / Cr 6100, one vendor) double-counts the primary leg — vendor shows
// $1000 vs $500 truth, and burn inflates — a divergent twin vs categories.
// Reachable via QBO-imported books (which contain reclass JEs). Must hold before
// O85 ships.
// ════════════════════════════════════════════════════════════════════════════

const CASH = "1000";
const dbEntry = (id, date, lines, desc) => ({
  id, entry_date: date, description: desc || id, source: "manual", status: "posted",
  deleted_at: null, created_at: `${date}T10:00:00Z`, import_metadata: null,
  journal_entry_lines: lines.map(l => ({ debit: l.debit || 0, credit: l.credit || 0, accounts: { code: l.code, name: l.code } })),
});

// $500 expense booked to 6100 for "Acme", then RECLASSED to 6200 (Dr 6200 / Cr 6100),
// same vendor. Economic truth: Acme spend is $500; total expense is $500; it now lives in 6200.
const flat = flattenJournalEntries([
  dbEntry("orig",    "2026-03-01", [{ code: "6100", debit: 500 }, { code: CASH, credit: 500 }], "Acme"),
  dbEntry("reclass", "2026-03-05", [{ code: "6200", debit: 500 }, { code: "6100", credit: 500 }], "Acme"),
]);
const sum = (rows, k = "total") => rows.reduce((s, r) => s + r[k], 0);

describe("F-3 — reclass nets in vendor + burn, and the twins agree", () => {
  it("computeVendorTotals counts the vendor ONCE ($500, not $1000)", () => {
    const vendors = computeVendorTotals(flat);
    const acme = vendors.find(v => v.vendor === "Acme");
    expect(acme.total).toBe(500);                       // was 1000 (primary-only double-count)
  });

  it("Σ(vendors) === Σ(categories) === computeExpenses (no divergent twin)", () => {
    const exp = computeExpenses(flat);
    expect(exp).toBe(500);
    expect(sum(computeVendorTotals(flat))).toBe(exp);
    expect(sum(computeCategoryTotals(flat))).toBe(exp);
  });

  it("categories reflect the move: 6200 = 500, 6100 netted to zero (dropped)", () => {
    const cats = computeCategoryTotals(flat);
    expect(cats.find(c => c.gl_code === "6200").total).toBe(500);
    expect(cats.find(c => c.gl_code === "6100")).toBeUndefined();
  });

  it("computeBurnRate is not inflated by the reclass (single month = 500, not 1000)", () => {
    expect(computeBurnRate(flat, { asOf: "2026-03-31" })).toBe(500);
  });
});
