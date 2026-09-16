import { describe, it, expect } from "vitest";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { openPayablesGL, glAccountBalance } from "../src/lib/reports.js";
import { matchableOpenItems } from "../src/lib/bankMatch.js";

// ═════════════════════════════════════════════════════════════════════════════
// C498 — A MULTI-LINE BILL WAS MISSING FROM "BILLS TO PAY" AND LISTED THREE TIMES ON THE
// MATCHING SCREEN. `C497`'s question asked of the A/P side, through the real flatten: a bill
// with two expense lines (Dr Food 500 / Dr Freight 20 / Cr A/P 520) expands to three rows.
// `openPayablesGL` ignored the offset on expanded rows and found NONE of them — Home's card
// showed $120 owed while the books said $640; `matchableOpenItems` accepted all three, so the
// bank matcher's universe held $1,040 of open items for a $520 bill and could match a $500
// ACH to the food line alone. One row per entry now — its A/P (A/R) leg, with the full amount.
// ═════════════════════════════════════════════════════════════════════════════
const chart = [
  { code: "1000", name: "Cash", category: "Assets", system_role: "cash" }, { code: "1100", name: "Accounts Receivable", category: "Assets", system_role: "accounts_receivable" },
  { code: "2000", name: "Accounts Payable", category: "Liabilities", system_role: "accounts_payable" }, { code: "2350", name: "Sales Tax Payable", category: "Liabilities" },
  { code: "4000", name: "Sales", category: "Revenue" }, { code: "5010", name: "Food Cost", category: "Expenses" }, { code: "5030", name: "Freight", category: "Expenses" },
];
const acct = (code) => ({ code, name: chart.find((a) => a.code === code)?.name });
const je = (id, date, description, lines, extra = {}) => ({ id, entry_date: date, description, status: "posted", deleted_at: null, source: "universal_upload",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: acct(l.code) })), ...extra });
const entries = [
  je("b1", "2026-09-02", "Sysco – produce + freight", [{ code: "5010", debit: 500 }, { code: "5030", debit: 20 }, { code: "2000", credit: 520 }], { payment_status: "unpaid" }),
  je("b2", "2026-09-03", "Roma – cheese", [{ code: "5010", debit: 120 }, { code: "2000", credit: 120 }], { payment_status: "unpaid" }),
  je("s1", "2026-09-04", "Acme – catering", [{ code: "1100", debit: 1299 }, { code: "4000", credit: 1200 }, { code: "2350", credit: 99 }], { payment_status: "unpaid" }),
];
const rows = flattenJournalEntries(entries, chart);
const codes = { arCode: "1100", apCode: "2000" };

describe("C498", () => {
  it("the shipped shape — demonstrated: three rows for one bill, all touching A/P", () => {
    expect(rows.filter((r) => String(r.id).startsWith("b1"))).toHaveLength(3);
  });
  it("Bills to pay counts the multi-line bill once, at its full amount, and ties to the A/P balance", () => {
    const open = openPayablesGL(rows, "2000");
    expect(open.map((r) => [r.id, r.amount])).toEqual([["b1_2", 520], ["b2", 120]]);
    expect(open.reduce((s, r) => s + r.amount, 0)).toBe(glAccountBalance("2000", rows));
  });
  it("the matcher's universe holds one item per entry, each at the amount a payment would settle", () => {
    const items = matchableOpenItems(rows, codes);
    expect(items.map((r) => [r.id, r.amount])).toEqual([["b1_2", 520], ["b2", 120], ["s1_0", 1299]]);
  });
  it("a settlement linked to the base entry clears every row of it", () => {
    const paid = flattenJournalEntries([...entries,
      je("p1", "2026-09-10", "Payment – Sysco", [{ code: "2000", debit: 520 }, { code: "1000", credit: 520 }], { import_metadata: { kind: "ap_payment", payment_for: "b1" }, payment_status: "paid" }),
    ], chart);
    expect(matchableOpenItems(paid, codes).map((r) => r.id)).toEqual(["b2", "s1_0"]);
  });
  it("a paid multi-line bill is not owed, and a debit to A/P (a payment) is never a bill", () => {
    const paid = rows.map((r) => (String(r.id).startsWith("b1") ? { ...r, payment_status: "paid" } : r));
    expect(openPayablesGL(paid, "2000").map((r) => r.id)).toEqual(["b2"]);
    const withPay = flattenJournalEntries([...entries,
      je("p2", "2026-09-11", "Payment – Roma (multi)", [{ code: "2000", debit: 120 }, { code: "1000", credit: 100 }, { code: "1000", credit: 20 }], { payment_status: "paid" }),
    ], chart);
    expect(openPayablesGL(withPay, "2000").map((r) => r.id)).toEqual(["b1_2", "b2"]);
  });
});
