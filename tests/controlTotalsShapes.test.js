import { describe, it, expect } from "vitest";
import { buildArInvoiceEntry } from "../src/lib/revenueEntries.js";
import { multiLineMetaPatch } from "../src/lib/entryMetaStamp.js";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { computeControlTotals } from "../src/lib/controlTotals.js";

// ═════════════════════════════════════════════════════════════════════════════
// C517 — THE FOUR TIES, OVER EVERY ENTRY SHAPE OF 2026-09-15, THROUGH THE REAL FLATTEN.
// C289 swept the control totals in both directions on the shapes that existed then; since
// then the readers learned the taxed three-line invoice (C497–C499), the multi-line bill
// (C498/C503), and the capitalized purchase on terms (C309/C513). Correct books holding all
// of them at once must tie on every check — and a collected flag with no collection entry
// behind it must still fire, so a change that quietly made the ties tautological is caught.
// ═════════════════════════════════════════════════════════════════════════════
const chart = [
  { code: "1000", name: "Cash", category: "Assets", system_role: "cash" }, { code: "1100", name: "Accounts Receivable", category: "Assets", system_role: "accounts_receivable" },
  { code: "1500", name: "Equipment", category: "Assets" }, { code: "2000", name: "Accounts Payable", category: "Liabilities", system_role: "accounts_payable" },
  { code: "2350", name: "Sales Tax Payable", category: "Liabilities", system_role: "sales_tax_payable" }, { code: "4000", name: "Sales", category: "Revenue" },
  { code: "5010", name: "Food Cost", category: "Expenses" }, { code: "5030", name: "Freight", category: "Expenses" },
];
const acct = (code) => ({ code, name: chart.find((a) => a.code === code)?.name });
const je = (id, date, description, lines, extra = {}) => ({ id, entry_date: date, description, status: "posted", deleted_at: null, source: "universal_upload",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: acct(l.code) })), ...extra });
const entries = [
  // C524 — the taxed invoice's metadata is what the REAL write path stamps (builder → RPC keeps six
  // scalars → multiLineMetaPatch), not a hand-typed `{ tax_amount: 99 }`: handed directly, this
  // fixture proved the check works GIVEN the data and said nothing about whether it arrives (·3a).
  je("s1", "2026-09-04", "Acme – catering", [{ code: "1100", debit: 1299 }, { code: "4000", credit: 1200 }, { code: "2350", credit: 99 }],
    { payment_status: "unpaid", import_metadata: multiLineMetaPatch(buildArInvoiceEntry({ subtotal: 1200, taxRate: 0.0825, arCode: "1100", revenueCode: "4000", salesTaxCode: "2350", date: "2026-09-04", customer: "Acme", invoiceNumber: "INV-1" }).meta).import_metadata }),
  je("s2", "2026-09-05", "Beta – design", [{ code: "1100", debit: 700 }, { code: "4000", credit: 700 }], { payment_status: "collected" }),
  je("c2", "2026-09-09", "Collection – Beta", [{ code: "1000", debit: 700 }, { code: "1100", credit: 700 }], { import_metadata: { kind: "ar_collection", payment_for: "s2" }, payment_status: "paid" }),
  je("sab", "2026-09-02", "Sabine – freezer", [{ code: "1500", debit: 4625 }, { code: "2000", credit: 4625 }], { payment_status: "unpaid" }),
  je("b1", "2026-09-03", "Sysco – produce + freight", [{ code: "5010", debit: 500 }, { code: "5030", debit: 20 }, { code: "2000", credit: 520 }], { payment_status: "unpaid" }),
  je("b2", "2026-09-04", "Roma – cheese", [{ code: "5010", debit: 120 }, { code: "2000", credit: 120 }], { payment_status: "paid" }),
  je("p2", "2026-09-10", "Payment – Roma", [{ code: "2000", debit: 120 }, { code: "1000", credit: 120 }], { import_metadata: { kind: "ap_payment", payment_for: "b2" }, payment_status: "paid" }),
];
const codes = { ar: "1100", ap: "2000", salesTax: "2350" };
const ties = (rows) => Object.fromEntries(computeControlTotals({ invoices: rows, reconciliations: [], intakeRows: [], codes }).checks.map((c) => [c.key, [c.a, c.b, c.ties]]));

describe("C517", () => {
  it("correct books holding every shape tie on every check", () => {
    const t = ties(flattenJournalEntries(entries, chart));
    expect(t.ar_tie).toEqual([1299, 1299, true]);
    expect(t.ap_tie).toEqual([5145, 5145, true]);
    expect(t.sales_tax_tie).toEqual([99, 99, true]);
    expect(t.trial_balance[2]).toBe(true);
  });
  it("and the ties still fire: a collected flag with no collection behind it, a paid flag with no payment", () => {
    const noCollection = flattenJournalEntries(entries.filter((e) => e.id !== "c2"), chart);
    expect(ties(noCollection).ar_tie).toEqual([1299, 1999, false]);
    const noPayment = flattenJournalEntries(entries.filter((e) => e.id !== "p2"), chart);
    expect(ties(noPayment).ap_tie).toEqual([5145, 5265, false]);
  });
});
