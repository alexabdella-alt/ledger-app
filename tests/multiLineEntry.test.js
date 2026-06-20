import { describe, it, expect } from "vitest";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { computeRevenue, computeExpenses, computeNetIncome, glAccountBalance } from "../src/lib/reports.js";

// ════════════════════════════════════════════════════════════════════════════
// PHASE 0 LOCK — the canonical multi-line write path, proven through the REAL
// flatten/derivation code (not hand-shaped fixtures).
//
// Two bugs this proves fixed:
//   1. DOUBLE-COUNT — contract entries were posted as N separate 2-line JEs
//      (per-line expansion) instead of ONE entry, doubling every balance.
//   2. OFFSET-LEG DIVERGENCE — flatten stranded revenue/expense on the offset
//      leg, so computeRevenue (primary-gl_code only) disagreed with
//      glAccountBalance (both legs). After the fix the P&L line is always primary.
//
// The headline assertion the user asked for: on a deferred-revenue recognition
// fixture, computeRevenue and glAccountBalance AGREE (and equal the single posted
// amount — no double-count).
// ════════════════════════════════════════════════════════════════════════════

// A DB-shaped journal entry exactly as Supabase returns it to flattenJournalEntries.
const dbEntry = (id, date, lines, over = {}) => ({
  id, entry_date: date, description: over.description || `${id} – entry`,
  source: over.source || "contract", status: "posted", deleted_at: null,
  created_at: `${date}T10:00:00Z`, ...over,
  journal_entry_lines: lines.map(l => ({
    debit: l.debit || 0, credit: l.credit || 0,
    accounts: { code: l.code, name: l.name || l.code },
  })),
});

describe("deferred-revenue recognition: posted ONCE, derivations AGREE", () => {
  // Dr Deferred Revenue (2300) / Cr Service Revenue (4200), $500, as ONE entry.
  const flat = flattenJournalEntries([
    dbEntry("rec1", "2026-03-01", [{ code: "2300" }, { code: "4200" }].map((l, i) =>
      i === 0 ? { code: "2300", debit: 500 } : { code: "4200", credit: 500 })),
  ]);

  it("flattens to a SINGLE row with revenue on the primary leg (not stranded on the offset)", () => {
    expect(flat).toHaveLength(1);
    expect(flat[0].gl_code).toBe("4200");          // P&L line is primary
    expect(flat[0].secondary_gl_code).toBe("2300"); // deferred-rev liability is the offset
    expect(flat[0].type).toBe("revenue");
    expect(flat[0].amount).toBe(500);
  });

  it("computeRevenue === glAccountBalance('4200') === 500 (the agreement / no divergence)", () => {
    expect(computeRevenue(flat)).toBe(500);
    expect(glAccountBalance("4200", flat)).toBe(500);
    expect(computeRevenue(flat)).toBe(glAccountBalance("4200", flat));   // ← headline
  });

  it("relieves Deferred Revenue (2300) by exactly 500 (liability falls)", () => {
    expect(glAccountBalance("2300", flat)).toBe(-500);
  });

  it("NO double-count: revenue is 500 × 1 — the old per-line/duplicate post would have been 1000", () => {
    // Simulate the OLD behavior: the same economic entry posted as TWO journal
    // entries (what per-line expansion produced). Revenue would double.
    const doublePosted = flattenJournalEntries([
      dbEntry("rec_a", "2026-03-01", [{ code: "2300", debit: 500 }, { code: "4200", credit: 500 }]),
      dbEntry("rec_b", "2026-03-01", [{ code: "2300", debit: 500 }, { code: "4200", credit: 500 }]),
    ]);
    expect(computeRevenue(doublePosted)).toBe(1000);   // the bug
    expect(computeRevenue(flat)).toBe(500);            // the fix: posted once
  });
});

describe("AR issue (#4): revenue lands on gl_code after flatten (latent divergence fixed)", () => {
  // Dr A/R (1100) / Cr Revenue (4000), $750 — the SendInvoice booking, as stored.
  const flat = flattenJournalEntries([
    dbEntry("inv1", "2026-04-01", [{ code: "1100", debit: 750 }, { code: "4000", credit: 750 }], { source: "sent_invoice" }),
  ]);
  it("computeRevenue sees it and agrees with glAccountBalance", () => {
    expect(flat[0].gl_code).toBe("4000");
    expect(computeRevenue(flat)).toBe(750);
    expect(glAccountBalance("4000", flat)).toBe(750);
    expect(glAccountBalance("1100", flat)).toBe(750);   // A/R (debit-normal asset) up 750
  });
});

describe("prepaid amortization (#9b): expense derivations agree", () => {
  // Dr Expense (6500) / Cr Prepaid (1300), $100.
  const flat = flattenJournalEntries([
    dbEntry("amort1", "2026-03-31", [{ code: "6500", debit: 100 }, { code: "1300", credit: 100 }]),
  ]);
  it("computeExpenses === glAccountBalance('6500') === 100; prepaid asset falls 100", () => {
    expect(flat[0].gl_code).toBe("6500");
    expect(computeExpenses(flat)).toBe(100);
    expect(glAccountBalance("6500", flat)).toBe(100);
    expect(glAccountBalance("1300", flat)).toBe(-100);
  });
});

describe("lease commencement (#12): 3-line entry, balanced, no net-income impact", () => {
  // Dr ROU (1800) 10000 / Cr Lease Liab current (2400) 4000 / Cr Lease Liab LT (2450) 6000.
  const flat = flattenJournalEntries([
    dbEntry("lease1", "2026-01-01", [
      { code: "1800", debit: 10000 }, { code: "2400", credit: 4000 }, { code: "2450", credit: 6000 },
    ]),
  ]);
  it("expands to 3 rows, moves no net income, and each balance-sheet account is right", () => {
    expect(flat).toHaveLength(3);
    expect(computeNetIncome(flat)).toBe(0);                 // no P&L line
    expect(glAccountBalance("1800", flat)).toBe(10000);     // ROU asset
    expect(glAccountBalance("2400", flat)).toBe(4000);      // current lease liability
    expect(glAccountBalance("2450", flat)).toBe(6000);      // long-term lease liability
  });
});

describe("balance-sheet-only entry still flattens first-debit primary (no regression)", () => {
  // A payment Dr A/P (2000) / Cr Cash (1000) — no P&L line; must keep prior behavior.
  const flat = flattenJournalEntries([
    dbEntry("pay1", "2026-04-10", [{ code: "2000", debit: 100 }, { code: "1000", credit: 100 }], { source: "manual" }),
  ]);
  it("primary stays the debit (A/P), net income unaffected", () => {
    expect(flat[0].gl_code).toBe("2000");
    expect(flat[0].debit_credit).toBe("debit");
    expect(computeNetIncome(flat)).toBe(0);
    expect(glAccountBalance("2000", flat)).toBe(-100);   // A/P (credit-normal liab) falls
    expect(glAccountBalance("1000", flat)).toBe(-100);   // cash falls
  });
});
