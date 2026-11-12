import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { cashCarriedIntoPeriod, reconBooksBalance } from "../src/lib/reconcile";
import { openingDiscrepancy } from "../src/lib/openingBalanceProposal";
import { flattenJournalEntries } from "../src/lib/ledger";
import { addDaysYMD } from "../src/lib/format";

// C627 — review finding K9: a false "opening balance doesn't match" on the first month.
const A = { cash: { id: "c", code: "1000", name: "Cash" }, obe: { id: "o", code: "3400", name: "OBE" }, rev: { id: "r", code: "4100", name: "Sales" } };
const je = (id, date, lines, source = "manual") => ({ id, entry_date: date, description: id, status: "posted", source,
  journal_entry_lines: lines.map(([a, debit, credit], i) => ({ id: `${id}-${i}`, account_id: A[a].id, debit, credit, accounts: A[a] })) });
const rows = flattenJournalEntries([
  je("open", "2026-01-01", [["cash", 5000, 0], ["obe", 0, 5000]], "opening_balance"),
  je("sale", "2026-01-05", [["cash", 300, 0], ["rev", 0, 300]]),
]);

describe("the first month", () => {
  it("★ the old measure — 'as of the day before' — read $0 and flagged a mismatch on correct books", () => {
    const old = reconBooksBalance(rows, ["1000"], { asOf: addDaysYMD("2026-01-01", -1) });
    expect(old).toBe(0);
    expect(openingDiscrepancy({ statedOpening: 5000, recordedOpening: old }).mismatch).toBe(true);
  });

  it("★ the carried-in cash includes the opening entry dated on the first day — and ties", () => {
    const carried = cashCarriedIntoPeriod(rows, ["1000"], "2026-01-01");
    expect(carried).toBe(5000);
    expect(openingDiscrepancy({ statedOpening: 5000, recordedOpening: carried }).mismatch).toBe(false);
  });

  it("the period's own activity is still excluded, and later months carry everything before them", () => {
    expect(cashCarriedIntoPeriod(rows, ["1000"], "2026-01-01")).toBe(5000);   // the Jan 5 sale is not carried in
    expect(cashCarriedIntoPeriod(rows, ["1000"], "2026-02-01")).toBe(5300);
  });

  it("both places that compare use it", () => {
    expect(readFileSync("src/App.jsx", "utf8")).toMatch(/const glCashAtPeriodStart = cashCarriedIntoPeriod\(invoicesRef\.current, \[cashCode\], der\.periodStart\);/);
    expect(readFileSync("src/components/views/ReconView.jsx", "utf8")).toMatch(/const glCashAtPeriodStart = cashCarriedIntoPeriod\(invoices, reconCashCodes, periodStart\);/);
  });
});
