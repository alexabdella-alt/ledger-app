import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { flattenJournalEntries } from "../src/lib/ledger.js";

// ═════════════════════════════════════════════════════════════════════════════
// C478 — THE INVOICE NUMBER NEVER REACHED THE DATABASE, SO THE DUPLICATE-BY-NUMBER CHECK
// ONLY EVER SAW ROWS BOOKED IN THE SAME SITTING. `journal_entries.reference_number` has been
// a column since the baseline; nothing wrote it, and the flatten never read it. The number is
// the one exact discriminator a flat-fee vendor's invoices have (`O117`/`O127`) and it was
// thrown away at the RPC boundary.
// ═════════════════════════════════════════════════════════════════════════════
describe("C478", () => {
  it("the flatten reads reference_number back as invoice_number", () => {
    const rows = flattenJournalEntries([{ id: "e1", entry_date: "2026-09-01", description: "Sysco – produce", status: "posted", reference_number: "INV-4471",
      journal_entry_lines: [{ id: "l1", debit: 100, credit: 0, accounts: { code: "5010", name: "Food" } }, { id: "l2", debit: 0, credit: 100, accounts: { code: "2000", name: "A/P" } }] }]);
    expect(rows[0].invoice_number).toBe("INV-4471");
    const none = flattenJournalEntries([{ id: "e2", entry_date: "2026-09-01", description: "x", status: "posted", journal_entry_lines: [] }]);
    expect(none[0].invoice_number).toBeNull();
  });
  it("persistJournalEntry writes the number to reference_number in the post-RPC stamp", () => {
    const app = fs.readFileSync("src/App.jsx", "utf8");
    const i = app.indexOf("const persistJournalEntry = async");
    const fn = app.slice(i, app.indexOf("const rpcMissing =", i));
    expect(fn).toMatch(/const refNum = invoice && invoice\.invoice_number \? String\(invoice\.invoice_number\)\.trim\(\)\.slice\(0, 120\) : "";/);
    expect(fn).toMatch(/\.\.\.\(refNum \? \{ reference_number: refNum \} : \{\}\)/);
    expect(fn.indexOf('supabase.rpc("post_journal_entry"')).toBeLessThan(fn.indexOf("reference_number: refNum"));
  });
  it("both duplicate checks read invoice_number off the ledger rows (the readers this stamp exists for)", () => {
    const app = fs.readFileSync("src/App.jsx", "utf8");
    expect((app.match(/ex\.invoice_number\.toLowerCase\(\) === /g) || []).length).toBe(2);
  });
});
