// ═════════════════════════════════════════════════════════════════════════════
// C524 — A TAXED INVOICE SENT FROM THE APP BLOCKED SIGN-OFF AFTER A RELOAD. `buildArInvoiceEntry`
// puts its tax in `meta.tax`; `persistMultiLineEntry` handed the whole meta to `p_meta`, which the
// RPC discards past six scalars (O95), and stamped nothing after — so the stored entry carried
// `import_metadata: null`, `taxChargedOnInvoices` read $0 against a real $99 liability, and
// `sales_tax_tie` failed HIGH. C517's shapes test handed the check `tax_amount` directly (·3a).
// This crosses the seam: real builder → the RPC's keep-six → the stamp → flatten → the check.
// ═════════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { buildArInvoiceEntry } from "../src/lib/revenueEntries.js";
import { computeControlTotals } from "../src/lib/controlTotals.js";
import { multiLineMetaPatch } from "../src/lib/entryMetaStamp.js";

const chart = [
  { code: "1000", name: "Cash", category: "Assets", system_role: "cash" }, { code: "1100", name: "Accounts Receivable", category: "Assets", system_role: "accounts_receivable" },
  { code: "2000", name: "Accounts Payable", category: "Liabilities", system_role: "accounts_payable" }, { code: "2350", name: "Sales Tax Payable", category: "Liabilities", system_role: "sales_tax_payable" },
  { code: "4000", name: "Sales", category: "Revenue" },
];
const acct = (code) => ({ code, name: chart.find(a => a.code === code)?.name });
const codes = { ar: "1100", ap: "2000", salesTax: "2350" };
// What `post_journal_entry` keeps of p_meta — the six named scalars — and nothing else.
const RPC_KEEPS = ["ai_reasoning", "ai_confidence", "approval_status", "payment_status", "payment_method", "due_date"];
const asStored = (je, id, patch) => {
  const row = { id, entry_date: je.date, description: je.description, status: "posted", deleted_at: null, source: je.source, import_metadata: null, reference_number: null,
    journal_entry_lines: je.lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit, credit: l.credit, accounts: acct(l.code) })) };
  for (const k of RPC_KEEPS) if (je.meta && je.meta[k] != null) row[k] = je.meta[k];
  if (patch) { if (patch.import_metadata) row.import_metadata = patch.import_metadata; if (patch.reference_number) row.reference_number = patch.reference_number; }
  return row;
};
const je = buildArInvoiceEntry({ subtotal: 1200, taxRate: 0.0825, arCode: "1100", revenueCode: "4000", salesTaxCode: "2350", date: "2026-09-09", customer: "Acme", invoiceNumber: "INV-0004", dueDate: "2026-10-09" });
const tie = (rows) => computeControlTotals({ invoices: rows, reconciliations: [], intakeRows: [], codes }).checks.find(c => c.key === "sales_tax_tie");

describe("C524", () => {
  it("THE REPRO — with only what the RPC keeps, the sales-tax check fails on a correct invoice", () => {
    const rows = flattenJournalEntries([asStored(je, "ar1", null)], chart);
    const c = tie(rows);
    expect([c.a, c.b, c.ties]).toEqual([0, 99, false]);
  });
  it("with the multi-line stamp applied, the check ties, and the invoice number is read back on every row", () => {
    const patch = multiLineMetaPatch(je.meta);
    expect(patch.import_metadata).toEqual({ tax_amount: 99, kind: "ar_invoice" });
    expect(patch.reference_number).toBe("INV-0004");
    const rows = flattenJournalEntries([asStored(je, "ar1", patch)], chart);
    const c = tie(rows);
    expect([c.a, c.b, c.ties]).toEqual([99, 99, true]);
    expect(rows.every(r => r.invoice_number === "INV-0004")).toBe(true);
  });
  it("an untaxed invoice stamps no tax figure, and an entry with nothing to stamp returns null", () => {
    const plain = buildArInvoiceEntry({ subtotal: 500, arCode: "1100", revenueCode: "4000", date: "2026-09-09", customer: "Acme", invoiceNumber: "INV-0005" });
    expect(multiLineMetaPatch(plain.meta).import_metadata).toEqual({ kind: "ar_invoice" });
    expect(multiLineMetaPatch({ payment_status: "paid" })).toBeNull();
    expect(multiLineMetaPatch(null)).toBeNull();
  });
  it("persistMultiLineEntry writes the patch through a checked update after the RPC, before returning the id", () => {
    const src = fs.readFileSync("src/App.jsx", "utf8").replace(/\/\/.*$/gm, "");
    const at = src.indexOf("const persistMultiLineEntry = async");
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf("const openingPosted", at));
    const rpc = body.indexOf('supabase.rpc("post_journal_entry"');
    const stamp = body.indexOf("const mp = multiLineMetaPatch(entry.meta);");
    const write = body.indexOf('patch, label: "multiLineMetaStamp"');
    const ret = body.indexOf("return newId;");
    expect(rpc).toBeGreaterThan(-1); expect(stamp).toBeGreaterThan(rpc); expect(write).toBeGreaterThan(stamp); expect(ret).toBeGreaterThan(write);
    expect(body.slice(stamp, ret)).toContain("if (!r.ok) {");
  });
});
