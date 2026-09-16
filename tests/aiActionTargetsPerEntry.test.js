// C520 — THE AI'S DESTRUCTIVE-ACTION TARGETS ARE ENTRIES, NOT LINES. `resolveActionTargets`
// matched flattened rows: "delete the $6,000 Sysco bill" found nothing (each line is $3,000), a
// four-line bill counted as four items against the bulk cap of three, and the confirm card read
// "Delete 3 transactions" for one bill. And App.jsx carried two more copies of the same matcher.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { resolveActionTargets, describeDestructiveAction } from "../src/lib/aiActionGate.js";

const chart = [
  { code: "2000", name: "Accounts Payable", category: "Liabilities", system_role: "accounts_payable" },
  { code: "5010", name: "Food Cost", category: "Expenses" },
  { code: "5030", name: "Freight", category: "Expenses" },
];
const acct = (code) => ({ code, name: chart.find(a => a.code === code)?.name });
const je = (id, date, description, lines) => ({
  id, entry_date: date, description, status: "posted", deleted_at: null, source: "universal_upload", payment_status: "unpaid",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: acct(l.code) })),
});
const fourLine = je("big", "2026-09-03", "Sysco – produce + freight", [
  { code: "5010", debit: 2000 }, { code: "5030", debit: 2000 }, { code: "5010", debit: 2000 }, { code: "2000", credit: 6000 },
]);
const simple = je("s", "2026-09-04", "Roma – cheese", [{ code: "5010", debit: 400 }, { code: "2000", credit: 400 }]);
const invoices = flattenJournalEntries([fourLine, simple], chart);

describe("C520 — AI action targets resolve per entry", () => {
  it("the shape under test: the four-line bill is four rows", () => {
    expect(invoices.filter(r => r.db_entry_id === "big" || String(r.id).startsWith("big_")).length).toBe(4);
  });

  it("'delete the Sysco bill' targets ONE entry, at the entry's total — not four items", () => {
    const t = resolveActionTargets({ type: "delete_invoice", vendor: "Sysco" }, { invoices });
    expect(t).toHaveLength(1);
    expect(t[0].amount).toBe(6000);
    const d = describeDestructiveAction({ type: "delete_invoice", vendor: "Sysco" }, { invoices });
    expect(d.count).toBe(1);
    expect(d.targets[0].label).toContain("$6,000.00");
  });

  it("'the $6,000 Sysco bill' is FOUND — the amount matches the entry, not a line", () => {
    expect(resolveActionTargets({ type: "delete_invoice", vendor: "Sysco", amount: 6000 }, { invoices })).toHaveLength(1);
    // and a line's share does not match, because no charge of that size exists
    expect(resolveActionTargets({ type: "delete_invoice", vendor: "Sysco", amount: 2000 }, { invoices })).toHaveLength(0);
  });

  it("an id cited off any line of the entry resolves to the one entry (void, delete, reverse)", () => {
    for (const type of ["delete_invoice", "void_invoice", "reverse_entry"]) {
      expect(resolveActionTargets({ type, invoice_id: "big_2" }, { invoices })).toHaveLength(1);
      expect(resolveActionTargets({ type, invoice_id: "big" }, { invoices })).toHaveLength(1);
    }
  });

  it("the NEGATIVE case — a simple entry still matches by its own id and amount", () => {
    expect(resolveActionTargets({ type: "delete_invoice", vendor: "Roma", amount: 400 }, { invoices })).toHaveLength(1);
    expect(resolveActionTargets({ type: "void_invoice", invoice_id: "s" }, { invoices })).toHaveLength(1);
  });

  it("a recode stays per LINE — each line has its own category", () => {
    expect(resolveActionTargets({ type: "recode", invoiceIds: ["big_0", "big_1"] }, { invoices })).toHaveLength(2);
  });

  it("App.jsx counts the bulk cap and executes through the SAME resolver — no second matcher", () => {
    const src = fs.readFileSync("src/App.jsx", "utf8").replace(/\/\/.*$/gm, "");
    const from = src.indexOf("let pendingDeletes = 0;");
    expect(from).toBeGreaterThan(-1);
    const bulk = src.slice(from, src.indexOf("const bulkBlocked", from));
    expect(bulk).toContain("resolveActionTargets(a, { invoices, contracts })");
    expect(bulk).not.toMatch(/invoices\.filter/);
    const ex = src.indexOf("const executeDestructiveAction");
    expect(ex).toBeGreaterThan(-1);
    const body = src.slice(ex, src.indexOf("const confirmAIActions", ex));
    expect(body).not.toMatch(/invoices\.filter\(i =>\s*i\.vendor/);
    expect(body).not.toMatch(/invoices\.find\(i => String\(i\.id\)/);
    expect((body.match(/resolveActionTargets\(action, \{ invoices, contracts \}\)/g) || []).length).toBeGreaterThanOrEqual(5);
  });
});
