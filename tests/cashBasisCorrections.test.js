import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { isCancelledOrCancelling } from "../src/lib/gl.js";

// ═════════════════════════════════════════════════════════════════════════════
// C481 — THE CASH-BASIS P&L SHOWED A CANCELED EXPENSE WITH NOTHING CANCELLING IT. A paid
// bill carries `payment_status: "paid"`; its correction does not — so the cash-basis filter
// (paid/collected rows only) kept the original and dropped the correction, and the canceled
// $500 stood on the report. And `i.source === "bank_feed"` was dead after a reload: stored
// bank lines read `bank_import` (the RPC normalises the name).
// ═════════════════════════════════════════════════════════════════════════════
const acct = (code, name) => ({ code, name });
const je = (id, date, description, lines, extra = {}) => ({ id, entry_date: date, description, status: "posted", deleted_at: null, source: "universal_upload",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: acct(l.code, l.name) })), ...extra });

// The cash-basis predicate, reproduced from ReportsView (structure-pinned below).
const cashBasis = (i) => isCancelledOrCancelling(i) || i.source === "bank_import" || i.source === "bank_feed" || i.payment_status === "paid" || i.payment_status === "collected";

describe("C481", () => {
  const rows = flattenJournalEntries([
    je("b1", "2026-07-10", "Sysco – produce", [{ code: "5010", name: "Food Cost", debit: 500 }, { code: "2000", name: "A/P", credit: 500 }], { payment_status: "paid" }),
    je("r1", "2026-09-15", "REVERSAL: Sysco – produce", [{ code: "2000", name: "A/P", debit: 500 }, { code: "5010", name: "Food Cost", credit: 500 }], { import_metadata: { kind: "reversal", reverses: "b1" } }),
    je("k1", "2026-08-02", "Toast – fees", [{ code: "6520", name: "Fees", debit: 40 }, { code: "1000", name: "Cash", credit: 40 }], { source: "bank_import", payment_status: "paid" }),
  ]);
  it("a paid bill and its correction are kept together on cash basis, so they net to zero", () => {
    const kept = rows.filter(cashBasis).map((r) => r.db_entry_id);
    expect(kept).toContain("b1"); expect(kept).toContain("r1");
    const net = rows.filter(cashBasis).filter((r) => r.gl_code === "5010").reduce((s, r) => s + (r.debit_credit === "credit" ? -r.amount : r.amount), 0);
    expect(net).toBe(0);
  });
  it("a stored bank line (source bank_import) is cash even without the flag", () => {
    const line = { ...rows.find((r) => r.db_entry_id === "k1"), payment_status: null };
    expect(cashBasis(line)).toBe(true);
  });
  it("the report's filter reads the same predicate", () => {
    const src = fs.readFileSync("src/components/views/ReportsView.jsx", "utf8");
    const seg = src.slice(src.indexOf('if (basisMode === "cash") {'), src.indexOf("return true; // accrual"));
    expect(seg).toMatch(/if \(isCancelledOrCancelling\(i\)\) return true;/);
    expect(seg).toMatch(/i\.source === "bank_import" \|\| i\.source === "bank_feed" \|\| i\.payment_status === "paid" \|\| i\.payment_status === "collected"/);
  });
});
