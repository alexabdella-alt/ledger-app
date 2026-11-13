// C717 — the "send an invoice and get paid" audit.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { invoiceSendBlockers, bookedInvoiceFacts, sentInvoiceChangeProblem, lineAmount } from "../src/lib/invoiceDraft.js";
import { sentInvoiceFromRow } from "../src/lib/arInvoiceRows.js";
import { invoiceStatusFromBooks } from "../src/lib/invoiceMarkPaid.js";

const je = (id, date, lines, extra = {}) => ({ id, entry_date: date, description: `Acme – ${id}`, status: "posted", deleted_at: null, source: "manual",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: { code: l.code, name: l.code } })), ...extra });

describe("★ a sent invoice is checked against the books, not the screen's copy", () => {
  const plain = flattenJournalEntries([je("e1", "2026-11-02", [{ code: "1200", debit: 1000 }, { code: "4000", credit: 1000 }], { due_date: "2026-12-02" })]);
  const taxed = flattenJournalEntries([je("e2", "2026-11-03", [{ code: "1200", debit: 1082.5 }, { code: "4000", credit: 1000 }, { code: "2350", credit: 82.5 }])]);
  it("reads the receivable, the date and the due date the books hold", () => {
    expect(bookedInvoiceFacts(plain, "e1", "1200")).toEqual({ total: 1000, date: "2026-11-02", due_date: "2026-12-02" });
    expect(bookedInvoiceFacts(taxed, "e2", "1200").total).toBe(1082.5);
    expect(bookedInvoiceFacts(plain, "nope", "1200")).toBe(null);
    // only the receivable it CREATED (a credit to receivables on the same entry is not owed)
    const net = flattenJournalEntries([je("e3", "2026-11-04", [{ code: "1200", debit: 1200 }, { code: "4000", credit: 1100 }, { code: "1200", credit: 100 }])]);
    expect(bookedInvoiceFacts(net, "e3", "1200").total).toBe(1200);
  });
  it("a changed amount or date is refused with the way to do it; the same invoice re-sends", () => {
    const booked = bookedInvoiceFacts(plain, "e1", "1200");
    expect(sentInvoiceChangeProblem({ ledger_id: "e1", invoice_number: "INV-0001", issue_date: "2026-11-02" }, 1500, booked))
      .toBe("INV-0001 was already sent for $1,000.00, and that's what your books hold. To change it, open the invoice's entry in Transactions, press Delete, and send a new invoice.");
    expect(sentInvoiceChangeProblem({ ledger_id: "e1", invoice_number: "INV-0001", issue_date: "2026-11-05" }, 1000, booked)).toMatch(/already sent dated Nov 2, 2026/);
    expect(sentInvoiceChangeProblem({ ledger_id: "e1", issue_date: "2026-11-02" }, 1000, booked)).toBe(null);
    expect(sentInvoiceChangeProblem({ ledger_id: "e1", issue_date: "2026-11-02" }, 1000.01, booked)).toMatch(/already sent for \$1,000\.00/);   // a cent is a change
    expect(sentInvoiceChangeProblem({ issue_date: "2026-11-02" }, 5, booked)).toBe(null);   // not sent yet
  });
});

describe("★ what the send now checks first", () => {
  const ok = { customer: "Acme", customer_email: "a@b.co", invoice_number: "INV-0002" };
  it("earlier invoices that didn't load, a signed-off month, a change the books can't follow", () => {
    expect(invoiceSendBlockers(ok, 10, [], {})).toEqual([]);
    expect(invoiceSendBlockers(ok, 10, [], { listLoadFailed: true })[0]).toMatch(/didn't load, so we can't check this invoice number/);
    expect(invoiceSendBlockers(ok, 10, [], { signedMonth: "October 2026" })[0]).toBe("October 2026 is signed off — pick an issue date in a month that's still open.");
    expect(invoiceSendBlockers(ok, 10, [], { bookedProblem: "X" })).toEqual(["X"]);
  });
});

describe("★ money to the cent", () => {
  it("a line is rounded, so the lines add to the subtotal", () => {
    expect(lineAmount(0.75, 45.5)).toBe(34.13);
    expect(lineAmount("2", "19.999")).toBe(40);
  });
  it("the tax rate comes back as typed", () => {
    const row = (lines, tax) => ({ id: "x", ar_invoice_lines: lines.map((a) => ({ amount: a, quantity: 1, unit_rate: a })), tax_amount: tax });
    expect(sentInvoiceFromRow(row([34.13, 34.13], 5.63)).tax_rate).toBe("8.25");
    expect(sentInvoiceFromRow(row([1000], 86.25)).tax_rate).toBe("8.625");   // (on $100, 8.625% and 8.63% give the same tax — either rebuilds the invoice)
    expect(sentInvoiceFromRow(row([100], 7)).tax_rate).toBe("7");
  });
});

describe("★ an invoice whose entry was deleted reads void", () => {
  it("and has no Mark paid", () => {
    const rows = flattenJournalEntries([
      je("e1", "2026-11-02", [{ code: "1200", debit: 1000 }, { code: "4000", credit: 1000 }]),
      je("r1", "2026-11-04", [{ code: "4000", debit: 1000 }, { code: "1200", credit: 1000 }], { import_metadata: { kind: "reversal", reverses: "e1" } }),
    ]);
    expect(invoiceStatusFromBooks({ ledger_id: "e1", status: "sent" }, rows)).toBe("void");
    expect(invoiceStatusFromBooks({ ledger_id: "e1", status: "sent" }, rows.filter((r) => r.db_entry_id === "e1").map((r) => ({ ...r, reversed_by: undefined })))).toBe("sent");
  });
});

describe("★ the screens", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  it("a paid bill or collected invoice isn't deleted while its payment stays — both doors", () => {
    expect(app).toMatch(/const paidBlock = paidRemovalBlock\(invoice\);\s*if \(paidBlock\) \{ showNotification\(paidBlock, "error"\); return \{ ok: false, blocked: "paid" \}; \}/);
    expect(app).toMatch(/\{ const paidBlock = paidRemovalBlock\(invoice\); if \(paidBlock\) \{ showNotification\(paidBlock, "error"\); return null; \} \}/);
    expect(app).toMatch(/if \(!base \|\| !settledBases\(invoicesRef\.current \|\| \[\]\)\.has\(base\)\) return null;/);
  });
  it("Mark paid with nothing to find says so", () => {
    expect(app).toMatch(/if \(!inv\) \{ console\.warn\("\[markBillPaid\] no invoice for entryId", String\(entryId\)\); showNotification\("We couldn't find that entry/);
  });
  it("'Not late yet' means not late; a negative balance keeps its sign", () => {
    const ar = readFileSync("src/components/views/ArView.jsx", "utf8");
    expect(ar).toMatch(/const b = days<=0\?"current":days<=30\?"d30"/);
    expect(ar).toMatch(/label:"Owed to you", value:fmtSignedMoney\(totalAR\)/);
    expect(ar).not.toMatch(/Not late yet \(0–30 days\)/);
  });
  it("the customer page calls a deleted invoice Removed", () => {
    expect(readFileSync("src/components/views/CustomersView.jsx", "utf8")).toMatch(/\{isCancelledOrCancelling\(i\)\s*\? <span[^>]*>Removed<\/span>/);
  });
  it("Send Invoice: rounded lines, the books' figures, the customer by any spelling, a refused save said", () => {
    const v = readFileSync("src/components/views/SendInvoiceView.jsx", "utf8");
    expect(v).toMatch(/updated\.amount = lineAmount\(updated\.qty, updated\.rate\)/);
    expect(v).toMatch(/const booked = draft\.ledger_id \? bookedInvoiceFacts\(invoices \|\| \[\], draft\.ledger_id, arCodeNow\) : null;/);
    expect(v).toMatch(/if \(bookedProblem\) \{ showNotification\(bookedProblem, "error"\); return; \}/);
    expect(v).toMatch(/findContactForName\(contacts\.filter\(c => c\.type === "customer"\), name, aliasIndex\)\s*\|\| contacts\.find\(c => norm\(c\.name\) === norm\(name\)\)/);
    expect(v).toMatch(/We couldn't save \$\{name\} as a customer/);
    expect(v).toMatch(/if \(!_linesKept\) showNotification\(`Invoice \$\{inv\.invoice_number\} saved ✓`\)/);
    expect(v).toMatch(/patch: \{ due_date: inv\.due_date \}, label: "invoice_due_date"/);
  });
});
