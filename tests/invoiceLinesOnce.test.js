import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// C601 — review finding F3: Save Draft then Send stored an invoice's lines twice.
const v = readFileSync("src/components/views/SendInvoiceView.jsx", "utf8");
const fn = v.slice(v.indexOf("const persistSent = async"), v.indexOf("const saved = { ...inv, id: dbId };"));

describe("an invoice's lines are replaced, never stacked", () => {
  it("★ the database allows deleting lines only while the invoice is a draft — the reason for the order", () => {
    const pol = readFileSync("supabase/migrations/061_je_policy_dedup.sql", "utf8");
    expect(pol).toMatch(/create policy arl_delete on public\.ar_invoice_lines\s*\n\s*for delete to authenticated\s*\n\s*using \(\s*\n\s*public\.is_company_writer\(company_id\)\s*\n\s*and \(select i\.status from public\.ar_invoices i\s*\n\s*where i\.id = ar_invoice_lines\.ar_invoice_id\) = 'draft'/);
  });

  it("★ old lines are deleted BEFORE the header (and its status) is updated", () => {
    const del = fn.indexOf('.from("ar_invoice_lines").delete()');
    const upd = fn.indexOf('table: "ar_invoices", id: dbId');
    expect(del).toBeGreaterThan(-1);
    expect(del).toBeLessThan(upd);
  });

  it("★ the delete is counted, and new lines go in only if every old one went", () => {
    expect(fn).toMatch(/if \(\(del\.data \|\| \[\]\)\.length !== oldIds\.length\) \{\s*\n\s*replaceLines = false;/);
    expect(fn).toMatch(/if \(replaceLines && lines\.length\) \{\s*\n\s*const li = await supabase\.from\("ar_invoice_lines"\)\.insert\(/);
  });

  it("a sent invoice's locked lines are said, not silently kept", () => {
    expect(fn).toMatch(/logAudit\("invoice_lines_locked"/);
    expect(fn).toMatch(/so its line items stay as they were sent — the other details were updated\./);
  });
});
