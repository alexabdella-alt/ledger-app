import { describe, it, expect } from "vitest";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { buildPaymentEntry, paymentNeedsGLMovement, paymentEntryLines } from "../src/lib/payments.js";
import { matchableOpenItems } from "../src/lib/bankMatch.js";

// ═════════════════════════════════════════════════════════════════════════════
// C499 — A TAXED INVOICE COLLECTED THROUGH A BANK MATCH WAS FLAGGED "COLLECTED" WITH NO
// CASH MOVEMENT. The matcher hands the A/R LEG row (Dr A/R 1,299 — its primary IS A/R);
// `paymentNeedsGLMovement` read only the offset, saw Revenue, said no; the flag flipped and
// A/R kept the full $1,299 while the deposit never entered the books. Run through the real
// flatten and the real matcher universe, so the row shapes are the ones production hands over.
// ═════════════════════════════════════════════════════════════════════════════
const chart = [
  { code: "1000", name: "Cash", category: "Assets", system_role: "cash" }, { code: "1100", name: "Accounts Receivable", category: "Assets", system_role: "accounts_receivable" },
  { code: "2000", name: "Accounts Payable", category: "Liabilities", system_role: "accounts_payable" }, { code: "2350", name: "Sales Tax Payable", category: "Liabilities" },
  { code: "4000", name: "Sales", category: "Revenue" }, { code: "5010", name: "Food Cost", category: "Expenses" }, { code: "5030", name: "Freight", category: "Expenses" },
];
const acct = (code) => ({ code, name: chart.find((a) => a.code === code)?.name });
const je = (id, date, description, lines, extra = {}) => ({ id, entry_date: date, description, status: "posted", deleted_at: null, source: "universal_upload",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: acct(l.code) })), ...extra });
const rows = flattenJournalEntries([
  je("s1", "2026-09-04", "Acme – catering", [{ code: "1100", debit: 1299 }, { code: "4000", credit: 1200 }, { code: "2350", credit: 99 }], { payment_status: "unpaid" }),
  je("b1", "2026-09-02", "Sysco – produce + freight", [{ code: "5010", debit: 500 }, { code: "5030", debit: 20 }, { code: "2000", credit: 520 }], { payment_status: "unpaid" }),
  je("b2", "2026-09-03", "Roma – cheese", [{ code: "5010", debit: 120 }, { code: "2000", credit: 120 }], { payment_status: "unpaid" }),
  je("p1", "2026-09-10", "Payment – Roma", [{ code: "2000", debit: 120 }, { code: "1000", credit: 100 }, { code: "1000", credit: 20 }], { payment_status: "paid" }),
], chart);
const codes = { arCode: "1100", apCode: "2000", accruedCode: "2100", cashCode: "1000", cashName: "Cash", date: "2026-09-12" };
const byId = (id) => rows.find((r) => r.id === id);
const legs = (e) => paymentEntryLines(e).map((l) => [l.code, l.debit || 0, l.credit || 0]);

describe("C499 · a settlement from the leg row", () => {
  it("the matcher's representative for the taxed invoice is its A/R leg row, and it now builds Dr Cash / Cr A/R for the full receivable", () => {
    const item = matchableOpenItems(rows, codes).find((r) => String(r.id).startsWith("s1"));
    expect(item.id).toBe("s1_0");
    expect(paymentNeedsGLMovement(item, "ar", codes)).toBe(true);
    const e = buildPaymentEntry(item, "ar", codes);
    expect(legs(e)).toEqual([["1000", 1299, 0], ["1100", 0, 1299]]);
  });
  it("the revenue row of the same invoice builds the identical entry (the C497 readers hand this one over)", () => {
    const e = buildPaymentEntry(byId("s1_1"), "ar", codes);
    expect(legs(e)).toEqual([["1000", 1299, 0], ["1100", 0, 1299]]);
  });
  it("a multi-line bill's A/P leg row pays the whole bill; a plain bill is unchanged", () => {
    expect(legs(buildPaymentEntry(byId("b1_2"), "ap", codes))).toEqual([["2000", 520, 0], ["1000", 0, 520]]);
    expect(legs(buildPaymentEntry(byId("b2"), "ap", codes))).toEqual([["2000", 120, 0], ["1000", 0, 120]]);
  });
  it("a settlement's own leg is never a bill — the A/P debit of a multi-line payment builds nothing", () => {
    const payLeg = rows.find((r) => String(r.id).startsWith("p1") && r.gl_code === "2000");
    expect(payLeg.debit_credit).toBe("debit");
    expect(buildPaymentEntry(payLeg, "ap", codes)).toBeNull();
    // and a taxed invoice's tax row (a credit to 2350, offset A/R) is not a receivable to collect
    expect(buildPaymentEntry(byId("s1_2"), "ar", codes)).toBeNull();
  });
});
