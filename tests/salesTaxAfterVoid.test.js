import { describe, it, expect } from "vitest";
import { computeControlTotals } from "../src/lib/controlTotals";
import { flattenJournalEntries } from "../src/lib/ledger";

// C617 — review finding R6: the sales-tax cross-check failed forever after a taxed invoice was voided.
const A = { ar: { id: "ar", code: "1100", name: "A/R" }, rev: { id: "v", code: "4100", name: "Services" }, tax: { id: "t", code: "2350", name: "Sales Tax" } };
const je = (id, lines, meta) => ({ id, entry_date: "2026-03-10", description: "Harbor Cafe", status: "posted", source: "manual", import_metadata: meta || null,
  journal_entry_lines: lines.map(([a, debit, credit], i) => ({ id: `${id}-${i}`, account_id: A[a].id, debit, credit, accounts: A[a] })) });
const invoice = je("i1", [["ar", 1086.25, 0], ["rev", 0, 1000], ["tax", 0, 86.25]], { tax_amount: 86.25 });
const voided = je("r1", [["ar", 0, 1086.25], ["rev", 1000, 0], ["tax", 86.25, 0]], { kind: "reversal", reverses: "i1" });
const taxCheck = (entries) => computeControlTotals({ invoices: flattenJournalEntries(entries), codes: { salesTax: "2350" } }).checks?.find?.((c) => c.key === "sales_tax_tie")
  || computeControlTotals({ invoices: flattenJournalEntries(entries), codes: { salesTax: "2350" } }).failed?.find?.((c) => c.key === "sales_tax_tie");

describe("the sales-tax check after a void", () => {
  it("a live taxed invoice ties: 86.25 charged, 86.25 owed", () => {
    const c = taxCheck([invoice]);
    expect([c.a, c.b, c.diff]).toEqual([86.25, 86.25, 0]);
  });

  it("★ voided: nothing charged, nothing owed — and it ties", () => {
    const c = taxCheck([invoice, voided]);
    expect([c.a, c.b, c.diff]).toEqual([0, 0, 0]);
  });
});
