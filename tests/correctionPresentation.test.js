import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { classifyTxn, txnStatus } from "../src/lib/txnPresent.js";

// ═════════════════════════════════════════════════════════════════════════════
// C470 — A CORRECTION READ AS A SECOND PURCHASE. It mirrors the entry it cancels, so it
// flattens with an expense primary and no paid flag: the list showed "−$500 · Paid" dated
// today, under the original struck through — two Sysco purchases, one of them marked
// removed. And three surfaces used three words for the removed original.
// ═════════════════════════════════════════════════════════════════════════════
const acct = (code, name) => ({ code, name });
const je = (id, date, description, lines, extra = {}) => ({ id, entry_date: date, description, status: "posted", deleted_at: null, source: "universal_upload",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: acct(l.code, l.name) })), ...extra });
const AP = "2000", AR = "1100";
const rows = flattenJournalEntries([
  je("b1", "2026-07-10", "Sysco – produce", [{ code: "5010", name: "Food Cost", debit: 500 }, { code: AP, name: "Accounts Payable", credit: 500 }]),
  je("r1", "2026-09-15", "REVERSAL: Sysco – produce", [{ code: AP, name: "Accounts Payable", debit: 500 }, { code: "5010", name: "Food Cost", credit: 500 }], { import_metadata: { kind: "reversal", reverses: "b1" } }),
  je("i1", "2026-07-12", "Acme – catering", [{ code: AR, name: "Accounts Receivable", debit: 900 }, { code: "4000", name: "Sales", credit: 900 }]),
  je("r2", "2026-09-15", "REVERSAL: Acme – catering", [{ code: "4000", name: "Sales", debit: 900 }, { code: AR, name: "Accounts Receivable", credit: 900 }], { import_metadata: { kind: "reversal", reverses: "i1" } }),
]);
const row = (id) => rows.find((r) => r.db_entry_id === id);

describe("C470 · a correction is presented as one", () => {
  it("the status reads Correction, not Paid or Booked", () => {
    const cls = classifyTxn(row("r1"), { apCode: AP, arCode: AR });
    expect(cls.correction).toBe(true);
    expect(txnStatus(row("r1"), cls)).toEqual({ label: "Correction", tone: "info" });
    expect(txnStatus(row("b1"), classifyTxn(row("b1"), { apCode: AP, arCode: AR })).label).not.toBe("Correction");
  });
  it("its money direction is the opposite of its account — an expense correction is money back", () => {
    expect(classifyTxn(row("r1"), { apCode: AP, arCode: AR }).inflow).toBe(true);
    expect(classifyTxn(row("r2"), { apCode: AP, arCode: AR }).inflow).toBe(false);
    expect(classifyTxn(row("b1"), { apCode: AP, arCode: AR }).inflow).toBe(false);   // the purchase itself is unchanged
  });
  it("the shared badge says Correction for the correction and Removed for its target, never Paid/Booked", () => {
    const panel = fs.readFileSync("src/components/TransactionDetailPanel.jsx", "utf8");
    const fn = panel.slice(panel.indexOf("export function txnStatusBadge(i) {"), panel.indexOf("// Inline source-document preview"));
    const corr = fn.indexOf("isReversalEntry(i)"), removed = fn.indexOf("i.reversed_by"), paid = fn.indexOf('i.payment_status === "paid"');
    expect(corr).toBeGreaterThan(-1); expect(removed).toBeGreaterThan(-1);
    expect(corr).toBeLessThan(paid); expect(removed).toBeLessThan(paid);
    expect(fn).toMatch(/isReversalEntry\(i\)\) return <span[^>]*>Correction</);
    expect(fn).toMatch(/i\.reversed_by\) return <span[^>]*>Removed</);
  });
  it("one word for the removed original across the list and the panel", () => {
    const books = fs.readFileSync("src/components/views/BooksView.jsx", "utf8");
    const panel = fs.readFileSync("src/components/TransactionDetailPanel.jsx", "utf8");
    expect(books).toMatch(/>↩ Removed\{rev\.date/);
    expect(books).not.toMatch(/>↩ Reversed/);
    expect(panel).toMatch(/Already removed\$\{reversedInfo\.date/);
    expect(panel).not.toMatch(/Already corrected\$\{/);
  });
});
