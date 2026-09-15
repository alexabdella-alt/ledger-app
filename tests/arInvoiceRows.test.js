import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { arInvoiceRows, sentInvoiceFromRow, isDbInvoiceId } from "../src/lib/arInvoiceRows.js";

// ═════════════════════════════════════════════════════════════════════════════
// C350 — A SENT INVOICE SURVIVES A RELOAD. `ar_invoices` was read on every load and written
// by nothing; `persistSent` was a setState. The round trip below is the property.
// ═════════════════════════════════════════════════════════════════════════════
const inv = {
  id: 1726000000000.42, invoice_number: "INV-1007", customer: "Metro Cafe", customer_email: "ap@metro.test",
  issue_date: "2026-09-14", due_date: "2026-10-14", terms: "Net 30", notes: "Thanks!", status: "sent",
  ledger_id: "6f0b8b7e-0e2f-4d2e-9a3b-1c2d3e4f5a6b",
  line_items: [{ id: 1, description: "Catering", qty: 2, rate: 450, amount: 900 }, { id: 2, description: "Delivery", qty: 1, rate: 35.5, amount: 35.5 }],
};

describe("★★ the rows a sent invoice becomes", () => {
  it("header totals are COMPUTED from the lines, never copied from the draft", () => {
    const { header, lines } = arInvoiceRows({ ...inv, subtotal: 999999 }, { companyId: "c1", taxAmount: 77.16 });
    expect(lines.map(l => l.amount)).toEqual([900, 35.5]);
    expect(header.subtotal).toBe(935.5);
    expect(header.tax_amount).toBe(77.16);
    expect(header.total).toBe(1012.66);
    expect(header.journal_entry_id).toBe(inv.ledger_id);
    expect(header.status).toBe("sent");
    expect(lines.map(l => l.sort_order)).toEqual([0, 1]);
  });
  it("a paid invoice stores paid", () => {
    expect(arInvoiceRows({ ...inv, status: "paid", paid_at: "2026-09-20T00:00:00Z" }, { companyId: "c1" }).header.status).toBe("paid");
  });
  it("refuses without a company", () => {
    expect(() => arInvoiceRows(inv, {})).toThrow();
  });
});

describe("★★ round trip — what was written is what is read, and ledger_id SURVIVES", () => {
  it("row → invoice keeps the journal entry, so 'mark paid' after a reload clears the A/R it booked", () => {
    const { header, lines } = arInvoiceRows(inv, { companyId: "c1", customerId: "k1", taxAmount: 0 });
    const row = { ...header, id: "9d6b1c3e-1111-4222-8333-444455556666", ar_invoice_lines: lines.map((l, i) => ({ ...l, id: `l${i}` })).reverse(), contacts: { name: "Metro Cafe", email: "ap@metro.test" } };
    const back = sentInvoiceFromRow(row);
    expect(back.ledger_id).toBe(inv.ledger_id);                      // the reload mapping used to DROP this
    expect(back.customer_email).toBe("ap@metro.test");                // and this was always ""
    expect(back.line_items.map(l => l.description)).toEqual(["Catering", "Delivery"]);   // sort_order, not arrival order
    expect(back.line_items.map(l => l.amount)).toEqual([900, 35.5]);
    expect(isDbInvoiceId(back.id)).toBe(true);
    expect(isDbInvoiceId(inv.id)).toBe(false);
  });
});

describe("★ the writer is wired and the reader is shared", () => {
  const view = fs.readFileSync(path.join(process.cwd(), "src/components/views/SendInvoiceView.jsx"), "utf8");
  const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
  it("SendInvoiceView inserts the header, then the lines against its id, and awaits it before claiming sent", () => {
    const hdr = view.indexOf('from("ar_invoices").insert(header)'), ln = view.indexOf('from("ar_invoice_lines").insert(');
    expect(hdr).toBeGreaterThan(0);
    expect(ln).toBeGreaterThan(hdr);
    expect(view).toMatch(/const saved = await persistSent\(inv, customerId\)/);
  });
  it("★ a failed persist is SAID, and does not claim the invoice will be there after a reload", () => {
    expect(view).toMatch(/invoice_persist_failed/);
    expect(view).toMatch(/it will not be here after a reload/);
  });
  it("★ marking paid updates the row through a CHECKED write, gated on the ledger write succeeding", () => {
    expect(view).toMatch(/if \(!ok\) return;[\s\S]{0,120}if \(isDbInvoiceId\(inv\.id\)\) \{[\s\S]{0,400}checkedRowUpdate\(\{ supabase, table: "ar_invoices"/);
  });
  it("the load reads through sentInvoiceFromRow and asks for the customer's email", () => {
    expect(app).toMatch(/setSentInvoices\(arData\.map\(sentInvoiceFromRow\)\)/);
    expect(app).toMatch(/ar_invoice_lines\(\*\), contacts\(name, email\)/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// C353 — THE CUSTOMER IS RESOLVED TO A DATABASE ID BEFORE THE INVOICE IS SAVED, and a draft
// is stored as a draft. `ensureCustomer` fired and did not wait, so the contact id at persist
// time was an in-session float — a uuid column would have refused it, and a null came back
// after a reload as an invoice with no customer name.
// ═════════════════════════════════════════════════════════════════════════════
describe("★ C353 — customer id and draft status", () => {
  it("a draft is stored as a draft; an unknown status is stored as sent", () => {
    expect(arInvoiceRows({ ...inv, status: "draft" }, { companyId: "c1" }).header.status).toBe("draft");
    expect(arInvoiceRows({ ...inv, status: "weird" }, { companyId: "c1" }).header.status).toBe("sent");
  });
  it("★ the send path AWAITS the customer's database id and hands it to the persist", () => {
    const view = fs.readFileSync(path.join(process.cwd(), "src/components/views/SendInvoiceView.jsx"), "utf8");
    expect(view).not.toMatch(/ensureCustomer\(\)/);
    expect(view).toMatch(/const customerId = await resolveCustomerId\(\);[\s\S]{0,1200}await persistSent\(inv, customerId\)/);
    // and it never hands a float to a uuid column: only a db_id or a uuid-shaped id is used —
    // through the shared resolver (C361), which is what the inline copy here was a copy of
    expect(view).toMatch(/const dbId = existing \? contactDbId\(existing\) : null;/);
  });
});
