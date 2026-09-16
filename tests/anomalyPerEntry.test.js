// C519 — A CHARGE IS AN ENTRY, NOT A LINE. The anomaly detector read `flattenJournalEntries`'
// expanded rows as separate charges: a two-line $6,000 bill was a HIGH duplicate against its
// own two lines (blocking sign-off), two round-number cards, and a large-charge card at the
// line's $3,000 rather than the entry's $6,000. Same class as C518, in the detector.
import { describe, it, expect } from "vitest";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { runAnomalyDetection, detectRecurringPatterns, perEntry } from "../src/lib/insights.js";

const chart = [
  { code: "2000", name: "Accounts Payable", category: "Liabilities", system_role: "accounts_payable" },
  { code: "5010", name: "Food Cost", category: "Expenses" },
  { code: "5030", name: "Freight", category: "Expenses" },
  { code: "6250", name: "Repairs & Maintenance", category: "Expenses" },
];
const acct = (code) => ({ code, name: chart.find(a => a.code === code)?.name });
const je = (id, date, description, lines, extra = {}) => ({
  id, entry_date: date, description, status: "posted", deleted_at: null, source: "universal_upload",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: acct(l.code) })),
  ...extra,
});
const NOW = new Date("2026-09-15T12:00:00");
const twoLineBill = (id, date, a, b) =>
  je(id, date, "Sysco – produce + freight", [{ code: "5010", debit: a }, { code: "5030", debit: b }, { code: "2000", credit: a + b }], { payment_status: "unpaid" });

describe("C519 — the anomaly detector reads one charge per entry", () => {
  it("THE REPRO — a two-line bill is not a duplicate of itself, and is not two round numbers", () => {
    const rows = flattenJournalEntries([twoLineBill("big", "2026-09-03", 3000, 3000)], chart);
    expect(rows.length).toBe(3);   // the shape under test: an expanded entry
    const out = runAnomalyDetection(rows, [], NOW, { apCode: "2000" });
    expect(out.filter(a => a.type === "duplicate_payment")).toHaveLength(0);
    expect(out.filter(a => a.type === "round_number")).toHaveLength(1);
    expect(out.filter(a => a.type === "rapid_sequential")).toHaveLength(0);
  });

  it("a large charge is judged at the entry's total — two $1,500 lines are a $3,000 charge", () => {
    // Repairs, not Food: `couldBeCapital` refuses the question for a food account (C302), so the
    // line's account must be one the question fits — the size is the thing under test here.
    const rows = flattenJournalEntries([je("mid", "2026-09-03", "Alamo Fire – hood + labor", [
      { code: "6250", debit: 1500 }, { code: "6250", debit: 1500 }, { code: "2000", credit: 3000 },
    ], { payment_status: "unpaid" })], chart);
    const large = runAnomalyDetection(rows, [], NOW, { apCode: "2000" }).filter(a => a.type === "large_transaction");
    expect(large).toHaveLength(1);
    expect(large[0].title).toContain("$3,000.00");
  });

  it("a three-line bill is not '3 charges in 48 hours'", () => {
    const rows = flattenJournalEntries([je("tri", "2026-09-03", "Sysco – order", [
      { code: "5010", debit: 400 }, { code: "5030", debit: 50 }, { code: "5010", debit: 120 }, { code: "2000", credit: 570 },
    ])], chart);
    const out = runAnomalyDetection(rows, [], NOW, { apCode: "2000" });
    expect(out.filter(a => a.type === "rapid_sequential")).toHaveLength(0);
  });

  it("the NEGATIVE case — two separate bills two days apart at the same total are still a duplicate", () => {
    const rows = flattenJournalEntries([
      twoLineBill("a", "2026-09-03", 3000, 3000),
      twoLineBill("b", "2026-09-05", 3000, 3000),
    ], chart);
    const dups = runAnomalyDetection(rows, [], NOW, { apCode: "2000" }).filter(a => a.type === "duplicate_payment");
    expect(dups).toHaveLength(1);
    expect(dups[0].description).toContain("$6,000.00");
  });

  it("category_spike still reads per LINE — a bill with a Food line and a Freight line spent in both", () => {
    const rows = flattenJournalEntries([
      twoLineBill("p1", "2026-07-03", 100, 100), twoLineBill("p2", "2026-08-03", 100, 100),
      je("s", "2026-09-03", "Sysco – freight surge", [{ code: "5010", debit: 100 }, { code: "5030", debit: 900 }, { code: "2000", credit: 1000 }]),
    ], chart);
    const cat = runAnomalyDetection(rows, [], NOW, { apCode: "2000" }).filter(a => a.type === "category_spike");
    expect(cat.map(a => a.id)).toEqual(["category_spike:5030:2026-09"]);   // Freight, not Food, not the whole bill
  });

  it("a monthly two-line bill is suggested as ONE monthly recurring charge at the bill's total", () => {
    const rows = flattenJournalEntries([
      twoLineBill("m1", "2026-07-01", 400, 100), twoLineBill("m2", "2026-08-01", 400, 100), twoLineBill("m3", "2026-09-01", 400, 100),
    ], chart);
    const s = detectRecurringPatterns(rows, [], NOW);
    expect(s).toHaveLength(1);
    expect(s[0].avgAmount).toBe(500);
    expect(s[0].count).toBe(3);
  });

  it("perEntry leaves simple rows alone", () => {
    const simple = [{ id: "x", amount: 42, vendor: "V" }];
    expect(perEntry(simple)).toEqual(simple);
  });
});
