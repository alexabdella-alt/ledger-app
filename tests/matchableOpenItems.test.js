import { describe, it, expect } from "vitest";
import { matchableOpenItems as moi } from "../src/lib/bankMatch.js";

// C531 — a STORED bank line reads `source: "bank_import"` (the RPC normalises the in-session
// "bank_feed"/"bank_statement" names), and the guard that keeps bank lines out of the matcher's
// open universe named only the in-session spellings — so after a reload it matched nothing. A
// payment booked from the bank rail without a link (a legacy line, or one the matcher could not
// pair) carries an A/P leg and was offered as an OPEN PAYABLE to match against: the O83 Feb shape.
describe("C531 — stored bank lines are never open items", () => {
  const rows = [
    { id: "bill", vendor: "Roma", amount: 300, date: "2026-02-01", gl_code: "5010", secondary_gl_code: "2000", debit_credit: "debit", type: "expense", payment_status: "unpaid", source: "universal_upload" },
    // a payment from the bank rail, stored, with no payment_for link
    { id: "bankpay", vendor: "Roma", amount: 300, date: "2026-02-10", gl_code: "2000", secondary_gl_code: "1000", debit_credit: "debit", type: "expense", payment_status: "paid", source: "bank_import" },
  ];
  it("the bill is open; the stored bank-rail payment is not offered as one", () => {
    expect(moi(rows, { arCode: "1100", apCode: "2000" }).map(r => r.id)).toEqual(["bill"]);
  });
});

// C542 — the bank-run tile's "open items still unmatched" is the matcher's universe, not every
// row typed expense/revenue without a paid flag (which counted the opening balance and every
// till purchase).
import fs from "node:fs";
import { flattenJournalEntries } from "../src/lib/ledger.js";
describe("C542 — the open-items figure after a bank run", () => {
  const chart = [{ code: "1000", name: "Cash", category: "Assets", system_role: "cash" }, { code: "2000", name: "Accounts Payable", category: "Liabilities", system_role: "accounts_payable" }, { code: "3400", name: "OBE", category: "Equity" }, { code: "5010", name: "Food Cost", category: "Expenses" }];
  const acct = (c) => ({ code: c, name: chart.find(a => a.code === c)?.name });
  const je = (id, date, description, lines, extra = {}) => ({ id, entry_date: date, description, status: "posted", deleted_at: null, source: "universal_upload", journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: acct(l.code) })), ...extra });
  const rows = flattenJournalEntries([
    je("ob", "2026-01-01", "Opening balances", [{ code: "1000", debit: 10000 }, { code: "3400", credit: 10000 }], { source: "opening_balance" }),
    je("till", "2026-02-01", "Corner – ice", [{ code: "5010", debit: 40 }, { code: "1000", credit: 40 }]),
    je("bill", "2026-02-02", "Roma – cheese", [{ code: "5010", debit: 300 }, { code: "2000", credit: 300 }], { payment_status: "unpaid" }),
  ], chart);
  it("the matcher's universe holds the one bill on terms — $300, not $10,340", () => {
    const open = moi(rows, { arCode: "1100", apCode: "2000" });
    expect(open.map(r => r.id)).toEqual(["bill"]);
    expect(open.reduce((s, r) => s + Math.abs(r.amount), 0)).toBe(300);
    // the old population, for the record
    const old = rows.filter(inv => (inv.type === "expense" || inv.type === "revenue") && inv.payment_status !== "paid" && inv.payment_status !== "collected").reduce((s, inv) => s + Math.abs(inv.amount || 0), 0);
    expect(old).toBe(10340);
  });
  it("App.jsx computes the tile's figure from matchableOpenItems", () => {
    const app = fs.readFileSync("src/App.jsx", "utf8").replace(/\/\/.*$/gm, "");
    const at = app.indexOf("const stillOpenTotal = matchableOpenItems(");
    expect(at).toBeGreaterThan(-1);
    expect(app).not.toMatch(/const stillOpenTotal = invoices\s*\.filter\(inv => \(inv\.type==="expense"/);
  });
});
