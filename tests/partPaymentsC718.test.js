// C718 — part-payments: recorded, linked, and the rest stays owed.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { settledBases, paidByBase, partlyPaidBases, entryAmountsByBase } from "../src/lib/gl.js";
import { openReceivablesGL, openPayablesGL, computeAR, agingReport, owedAmount, glAccountBalance } from "../src/lib/reports.js";
import { matchableOpenItems, autoMatchBankLines, matchAmountProblem, planBankImport } from "../src/lib/bankMatch.js";
import { buildPaymentEntry } from "../src/lib/payments.js";
import { invoiceStatusFromBooks } from "../src/lib/invoiceMarkPaid.js";

const je = (id, date, lines, extra = {}) => ({ id, entry_date: date, description: `Acme – ${id}`, status: "posted", deleted_at: null, source: "manual",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: { code: l.code, name: l.code } })), ...extra });
const inv = je("i1", "2026-10-01", [{ code: "1200", debit: 1000 }, { code: "4000", credit: 1000 }], { due_date: "2026-10-31" });
const col = (id, amt, date = "2026-10-20") => je(id, date, [{ code: "1000", debit: amt }, { code: "1200", credit: amt }], { import_metadata: { kind: "ar_collection", payment_for: "i1" } });

describe("★ settled means PAID IN FULL", () => {
  it("$400 of $1,000: part-paid, still open for $600", () => {
    const rows = flattenJournalEntries([inv, col("k1", 400)]);
    expect(entryAmountsByBase(rows).get("i1")).toBe(1000);
    expect(paidByBase(rows).get("i1")).toBe(400);
    expect(settledBases(rows).has("i1")).toBe(false);
    expect(partlyPaidBases(rows).get("i1")).toBe(400);
    const open = openReceivablesGL(rows, "1200");
    expect(open.map((r) => [r.db_entry_id, owedAmount(r)])).toEqual([["i1", 600]]);
    expect(computeAR(rows, { arCode: "1200" }).total).toBe(600);
    expect(agingReport(rows, "ar", new Date(2026, 10, 13), { arCode: "1200" }).total).toBe(600);
    expect(glAccountBalance("1200", rows)).toBe(600);   // the list and the books agree
  });
  it("the invoice reads part paid, then paid", () => {
    expect(invoiceStatusFromBooks({ ledger_id: "i1", status: "sent" }, flattenJournalEntries([inv, col("k1", 400)]))).toBe("partial");
    expect(invoiceStatusFromBooks({ ledger_id: "i1", status: "sent" }, flattenJournalEntries([inv, col("k1", 400), col("k2", 600)]), settledBases(flattenJournalEntries([inv, col("k1", 400), col("k2", 600)])))).toBe("paid");
  });
  it("the rest paid: settled, off every list", () => {
    const rows = flattenJournalEntries([inv, col("k1", 400), col("k2", 600, "2026-11-02")]);
    expect(settledBases(rows).has("i1")).toBe(true);
    expect(openReceivablesGL(rows, "1200")).toEqual([]);
  });
  it("a reversed part-payment counts for nothing", () => {
    const back = je("k1r", "2026-10-21", [{ code: "1200", debit: 400 }, { code: "1000", credit: 400 }], { import_metadata: { kind: "reversal", reverses: "k1" } });
    const rows = flattenJournalEntries([inv, col("k1", 400), back]);
    expect(paidByBase(rows).get("i1")).toBe(undefined);
    expect(owedAmount(openReceivablesGL(rows, "1200")[0])).toBe(1000);
  });
  it("a multi-line bill part-paid shows what's left", () => {
    const bill = je("b1", "2026-10-01", [{ code: "6600", debit: 300 }, { code: "6200", debit: 220 }, { code: "2000", credit: 520 }]);
    const pay = je("p1", "2026-10-05", [{ code: "2000", debit: 200 }, { code: "1000", credit: 200 }], { import_metadata: { kind: "ap_payment", payment_for: "b1" } });
    const rows = flattenJournalEntries([bill, pay]);
    const open = openPayablesGL(rows, "2000");
    expect(open.map((r) => [owedAmount(r), r._paid])).toEqual([[320, 200]]);
    const rest = je("p2", "2026-10-09", [{ code: "2000", debit: 320 }, { code: "1000", credit: 320 }], { import_metadata: { kind: "ap_payment", payment_for: "b1" } });
    expect(openPayablesGL(flattenJournalEntries([bill, pay, rest]), "2000")).toEqual([]);   // its lines, counted once each side
  });
  it("a payment entry with several lines counts once, at what it cleared", () => {
    const three = je("k3", "2026-10-20", [{ code: "1000", debit: 380 }, { code: "6150", debit: 20 }, { code: "1200", credit: 400 }], { import_metadata: { kind: "ar_collection", payment_for: "i1" } });
    expect(paidByBase(flattenJournalEntries([inv, three])).get("i1")).toBe(400);
  });
});

describe("★ the bank side", () => {
  const rows = flattenJournalEntries([inv, col("k1", 400)]);
  it("a part-paid invoice is open for what's left — and matches only that", () => {
    const items = matchableOpenItems(rows, { arCode: "1200", apCode: "2000" });
    expect(items.map((i) => [i.db_entry_id, i.balance_remaining])).toEqual([["i1", 600]]);
    const deposit = (amount) => [{ id: "t", vendor: "Acme", amount, type: "revenue", date: "2026-11-03" }];
    expect(autoMatchBankLines(deposit(600), items, { arCode: "1200", apCode: "2000" })).toHaveLength(1);
    expect(autoMatchBankLines(deposit(1000), items, { arCode: "1200", apCode: "2000" })).toHaveLength(0);
  });
  it("its clearing is built for what's left", () => {
    const items = matchableOpenItems(rows, { arCode: "1200", apCode: "2000" });
    const auto = autoMatchBankLines([{ id: "t", vendor: "Acme", amount: 600, type: "revenue", date: "2026-11-03" }], items, { arCode: "1200", apCode: "2000" });
    const plan = planBankImport({ parsedTxns: [], autoCleared: auto, openItems: items, codes: { arCode: "1200", apCode: "2000", cashCode: "1000", cashName: "Cash" } });
    expect(plan.clears.map((c) => c.entry.amount)).toEqual([600]);
  });
  it("less than is owed on one item is a part-payment; more is not matched", () => {
    expect(matchAmountProblem({ invoice_ids: [rows[0].id], bank_txn: { amount: 250 } }, rows)).toEqual({ bank: 250, owed: 600, partial: true });
    expect(matchAmountProblem({ invoice_ids: [rows[0].id], bank_txn: { amount: 600 } }, rows)).toBe(null);
    expect(matchAmountProblem({ invoice_ids: [rows[0].id], bank_txn: { amount: 900 } }, rows)).toEqual({ bank: 900, owed: 600, partial: false });
  });
  it("a payment entry can be for part, never for more", () => {
    const bill = { vendor: "V", amount: 500, gl_code: "6100", secondary_gl_code: "2000", debit_credit: "debit" };
    expect(buildPaymentEntry(bill, "ap", { apCode: "2000", cashCode: "1000", amount: 120 }).amount).toBe(120);
    expect(buildPaymentEntry(bill, "ap", { apCode: "2000", cashCode: "1000", amount: 900 }).amount).toBe(500);
    expect(buildPaymentEntry(bill, "ap", { apCode: "2000", cashCode: "1000" }).amount).toBe(500);
  });
});

describe("★ the app records it", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  it("markBillPaid: what's left by default, a part when asked, never more, no paid flag on a part", () => {
    expect(app).toMatch(/const payAmount = amount != null \? Math\.round\(Math\.abs\(Number\(amount\) \|\| 0\) \* 100\) \/ 100 : remaining;/);
    expect(app).toMatch(/if \(amount != null && remaining != null && payAmount > remaining \+ 0\.005\) \{/);
    expect(app).toMatch(/if \(!isPartial\) apply\(\{ payment_status: newStatus/);
    expect(app).toMatch(/if \(isPartial\) \{\s*if \(!postedPaymentId\) return await fail/);
    expect(app).toMatch(/return \{ partial: true, amount: payAmount, left \};/);
  });
  it("the bank match records a part-payment on one item and says what's still owed", () => {
    expect(app).toMatch(/const partialPay = amountProblem && amountProblem\.partial && \(invoice_ids \|\| \[\]\)\.length === 1;/);
    expect(app).toMatch(/still owed ✓`/);
    expect(app).not.toMatch(/choose "Dismiss" to add the bank line on its own/);
  });
  it("Bills to pay shows what's left and what was paid", () => {
    const ap = readFileSync("src/components/views/ApView.jsx", "utf8");
    expect(ap).toMatch(/\{fmt\(owedAmount\(inv\)\)\}/);
    expect(ap).toMatch(/\{fmt\(inv\._paid\)\} paid of \{fmt\(owedAmount\(inv\) \+ inv\._paid\)\}/);
  });
});
