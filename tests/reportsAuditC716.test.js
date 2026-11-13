// C716 — the Reports audit: cash basis dated by the money, month-end receivables, fiscal presets,
// both P&L legs, opening receivables on the aging report, cash flow without the opening balance.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { cashBasisPLRows, buildMonthlyReport, fiscalYearSplit, computeNetIncome, agingReport, glAccountBalance } from "../src/lib/reports.js";
import { reportRangeBounds } from "../src/lib/reportRange.js";

const je = (id, date, lines, extra = {}) => ({ id, entry_date: date, description: `V – ${id}`, status: "posted", deleted_at: null, source: "universal_upload",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: { code: l.code, name: l.code } })), ...extra });
const CODES = { apCode: "2000", arCode: "1200" };
const pl = (rows, code) => rows.filter((r) => r.gl_code === code).map((r) => [r.date, r.amount]);

describe("★ cash basis counts a bill when it was paid, in proportion to what was paid", () => {
  const bill = je("b1", "2026-01-20", [{ code: "6100", debit: 2000 }, { code: "2000", credit: 2000 }], { payment_status: "paid" });
  const pay = (id, date, amt) => je(id, date, [{ code: "2000", debit: amt }, { code: "1000", credit: amt }], { import_metadata: { kind: "ap_payment", payment_for: "b1" } });
  it("a January bill paid in February is February's", () => {
    expect(pl(cashBasisPLRows(flattenJournalEntries([bill, pay("p1", "2026-02-10", 2000)]), CODES), "6100")).toEqual([["2026-02-10", 2000]]);
  });
  it("paid in two parts, it counts twice, each part on its own date", () => {
    expect(pl(cashBasisPLRows(flattenJournalEntries([bill, pay("p1", "2026-02-10", 500), pay("p2", "2026-03-05", 1500)]), CODES), "6100"))
      .toEqual([["2026-02-10", 500], ["2026-03-05", 1500]]);
  });
  it("unpaid — whatever its flag says — it isn't cash yet; a payment that was taken back doesn't count", () => {
    expect(pl(cashBasisPLRows(flattenJournalEntries([bill]), CODES), "6100")).toEqual([]);
    const p = pay("p1", "2026-02-10", 2000);
    const back = je("p1r", "2026-02-12", [{ code: "1000", debit: 2000 }, { code: "2000", credit: 2000 }], { import_metadata: { kind: "reversal", reverses: "p1" } });
    expect(pl(cashBasisPLRows(flattenJournalEntries([bill, p, back]), CODES), "6100")).toEqual([]);
  });
  it("spending paid at once (bank, card, owner) counts on its own date", () => {
    const card = je("c1", "2026-01-05", [{ code: "6500", debit: 60 }, { code: "2150", credit: 60 }]);
    const dep = je("d1", "2026-01-07", [{ code: "6900", debit: 100 }, { code: "1510", credit: 100 }]);
    const rows = cashBasisPLRows(flattenJournalEntries([card, dep]), CODES);
    expect(pl(rows, "6500")).toEqual([["2026-01-05", 60]]);
    expect(pl(rows, "6900")).toEqual([["2026-01-07", 100]]);
  });
  it("a taxed invoice collected in part counts that share of its sales, not of the tax", () => {
    const inv = je("i1", "2026-08-10", [{ code: "1200", debit: 1080 }, { code: "4000", credit: 1000 }, { code: "2350", credit: 80 }]);
    const col = je("k1", "2026-09-05", [{ code: "1000", debit: 540 }, { code: "1200", credit: 540 }], { import_metadata: { kind: "ar_collection", payment_for: "i1" } });
    const chart = [{ code: "4000", category: "Revenue" }, { code: "1200", system_role: "accounts_receivable" }];
    expect(pl(cashBasisPLRows(flattenJournalEntries([inv, col], chart), CODES), "4000")).toEqual([["2026-09-05", 500]]);
  });
});

describe("★ the monthly report says what was owed at month end", () => {
  const inv = (id, date, amt) => je(id, date, [{ code: "1200", debit: amt }, { code: "4000", credit: amt }], { due_date: date });
  const ledger = flattenJournalEntries([
    inv("a", "2026-08-10", 1000),
    je("ka", "2026-09-05", [{ code: "1000", debit: 1000 }, { code: "1200", credit: 1000 }], { import_metadata: { kind: "ar_collection", payment_for: "a" } }),
    inv("b", "2026-10-03", 5000),
  ]);
  it("August: the $1,000 collected in September was owed; October's invoice wasn't issued yet", () => {
    const r = buildMonthlyReport("2026-08", { invoices: ledger, arCode: "1200", apCode: "2000" });
    expect([r.receivables.total, r.receivables.count]).toEqual([1000, 1]);
    expect(glAccountBalance("1200", ledger, { asOf: "2026-08-31" })).toBe(1000);
  });
  it("October: only the October invoice", () => {
    const r = buildMonthlyReport("2026-10", { invoices: ledger, arCode: "1200", apCode: "2000" });
    expect([r.receivables.total, r.receivables.count]).toEqual([5000, 1]);
  });
});

describe("★ the presets follow the fiscal year", () => {
  const nov = new Date(2026, 10, 13), mar = new Date(2027, 2, 2);
  it("July–June: 'year to date' starts in July; the quarters are fiscal", () => {
    expect(reportRangeBounds("ytd", nov, { fiscalYearEnd: "06-30" })).toEqual({ from: "2026-07-01", to: "2027-06-30" });
    expect(reportRangeBounds("q1", nov, { fiscalYearEnd: "06-30" })).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(reportRangeBounds("q3", nov, { fiscalYearEnd: "06-30" })).toEqual({ from: "2027-01-01", to: "2027-03-31" });
    expect(reportRangeBounds("ytd", mar, { fiscalYearEnd: "06-30" })).toEqual({ from: "2026-07-01", to: "2027-06-30" });
    expect(reportRangeBounds("q4", mar, { fiscalYearEnd: "06-30" })).toEqual({ from: "2027-04-01", to: "2027-06-30" });
  });
  it("a calendar year is unchanged", () => {
    expect(reportRangeBounds("ytd", nov)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(reportRangeBounds("q2", nov)).toEqual({ from: "2026-04-01", to: "2026-06-30" });
  });
});

describe("★ a reclass between two P&L accounts moves both, everywhere", () => {
  it("the balance sheet's net income equals the Income Statement's", () => {
    const rows = flattenJournalEntries([
      je("s", "2026-03-01", [{ code: "1000", debit: 1000 }, { code: "4000", credit: 1000 }]),
      je("x", "2026-03-02", [{ code: "6200", debit: 400 }, { code: "6100", credit: 400 }]),
      je("y", "2026-03-03", [{ code: "6100", debit: 300 }, { code: "1000", credit: 300 }]),
    ]);
    const s = fiscalYearSplit(rows, { asOf: "2026-08-30" });
    expect(s.priorNet + s.currentNet).toBe(computeNetIncome(rows));
    expect(computeNetIncome(rows)).toBe(700);
  });
});

describe("★ money owed from before you started is on the aging report", () => {
  const opening = je("ob", "2026-01-01", [{ code: "1000", debit: 10000 }, { code: "1200", debit: 2000 }, { code: "3400", credit: 12000 }], { source: "opening_balance" });
  it("the buckets add to the headline", () => {
    const rows = flattenJournalEntries([opening]);
    const rep = agingReport(rows, "ar", new Date(2026, 1, 1), { arCode: "1200" });
    expect([rep.total, rep.count]).toEqual([2000, 1]);
    expect(rep.buckets.flatMap((b) => b.rows).map((r) => [r.party, r.amount])).toEqual([["Owed before you started", 2000]]);
  });
  it("a collection booked straight to receivables shrinks it; never below zero", () => {
    const col = je("k", "2026-01-15", [{ code: "1000", debit: 1500 }, { code: "1200", credit: 1500 }]);
    expect(agingReport(flattenJournalEntries([opening, col]), "ar", new Date(2026, 1, 1), { arCode: "1200" }).total).toBe(500);
    const all = je("k2", "2026-01-20", [{ code: "1000", debit: 500 }, { code: "1200", credit: 500 }]);
    expect(agingReport(flattenJournalEntries([opening, col, all]), "ar", new Date(2026, 1, 1), { arCode: "1200" }).count).toBe(0);
  });
});

describe("★ the screen", () => {
  const v = readFileSync("src/components/views/ReportsView.jsx", "utf8");
  it("cash flow leaves the opening balance out and runs from the books' cash", () => {
    expect(v).toMatch(/if \(inv\.source === "opening_balance"\) continue;/);
    expect(v).toMatch(/cashRows\.forEach\(r => \{ r\.balance = glCashOnHand\(invoices, cfCashCodes, \{ asOf: monthEndYmd\(r\.month\) \}\); \}\);/);
    expect(v).toMatch(/const running = row\.balance;/);
    expect(v).toMatch(/data-cash-start/);
  });
  it("no figure prints its minus twice", () => {
    expect(v).not.toMatch(/\{\w+<0\?"-":""\}\{fmt\((?!Math\.abs)/);   // a sign, then a formatter that prints its own
  });
  it("the P&L lines and the balance sheet use both P&L legs", () => {
    expect(v).toMatch(/plFiltered\.forEach\(inv => plLegs\(inv, glIsExpense\)\.forEach/);
    expect(v).toMatch(/const bsRevenue  = legSum\(bsInvoices, glIsRevenue\);/);
  });
  it("a cash-basis line opens the entry it came from", () => {
    expect(v).toMatch(/setDrillSel\(inv\._cashOf \?\? inv\.id\)/);
  });
});
