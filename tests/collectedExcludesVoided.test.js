import { describe, it, expect } from "vitest";
import { receivableEntries, openReceivables } from "../src/lib/receivables";
import { flattenJournalEntries } from "../src/lib/ledger";

// C619 — review finding R8: "Collected (Total)" counted a voided invoice, twice.
const A = { ar: { id: "ar", code: "1100", name: "A/R" }, rev: { id: "v", code: "4100", name: "Services" }, cash: { id: "c", code: "1000", name: "Cash" } };
const je = (id, lines, meta) => ({ id, entry_date: "2026-03-10", description: "Harbor Cafe", status: "posted", source: "manual", import_metadata: meta || null,
  journal_entry_lines: lines.map(([a, debit, credit], i) => ({ id: `${id}-${i}`, account_id: A[a].id, debit, credit, accounts: A[a] })) });
const collected = ["paid1", je("paid1", [["ar", 500, 0], ["rev", 0, 500]]), je("col1", [["cash", 500, 0], ["ar", 0, 500]], { payment_for: "paid1" })];
const voidedInv = je("v1", [["ar", 1000, 0], ["rev", 0, 1000]]);
const voiding = je("r1", [["ar", 0, 1000], ["rev", 1000, 0]], { kind: "reversal", reverses: "v1" });
const base = (i) => String(i.db_entry_id ?? String(i.id).split("_")[0]);

describe("a voided invoice is neither open nor collected", () => {
  const rows = flattenJournalEntries([collected[1], collected[2], voidedInv, voiding]);
  const all = receivableEntries(rows, "1100");
  const open = new Set(openReceivables(rows, "1100").map(base));
  const collectedRows = all.filter((i) => !open.has(base(i)));   // exactly the screen's rule

  it("★ collected counts only the invoice that was actually paid", () => {
    expect(collectedRows.map(base)).toEqual(["paid1"]);
  });

  it("★ the voided invoice and its correction are not in the receivables at all", () => {
    expect(all.map(base).filter((b) => b === "v1" || b === "r1")).toEqual([]);
  });
});
