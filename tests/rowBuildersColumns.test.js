// ═════════════════════════════════════════════════════════════════════════════
// C544 — EVERY ROW BUILDER'S KEYS ARE COLUMNS OF ITS TABLE. C525's census reads inline write
// literals; the builders (`build*Row`, `arInvoiceRows`, `unknownDocRow`, …) are the other writer
// shape, and one of them — `recordRecurringRun`'s patch — was where C525's own defect lived. Each
// builder is called with representative arguments and its output keys held to the DDL (baseline
// plus every later `create table` / `add column`).
// ═════════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { arInvoiceRows } from "../src/lib/arInvoiceRows.js";
import { buildVendorRuleRow, buildRecurringRow, recurringRunPatch } from "../src/lib/chatActions.js";
import { buildStatementRow, buildStatementLineRows } from "../src/lib/bankStatements.js";
import { buildIntakeRow } from "../src/lib/documentIntake.js";
import { unknownDocRow } from "../src/lib/unknownDocs.js";
import { anomalyInsertRow } from "../src/lib/anomalies.js";
import { vendorStateRow } from "../src/lib/vendorTier.js";
import { buildAccountInsert, buildCompanyUpdate } from "../src/lib/writeShapes.js";

const MIG = "supabase/migrations";
const columns = new Map();
const add = (t, c) => { if (!columns.has(t)) columns.set(t, new Set()); columns.get(t).add(c); };
{
  const base = fs.readFileSync(path.join(MIG, "000_baseline_schema.sql"), "utf8");
  for (const m of base.matchAll(/CREATE TABLE public\.([a-z_0-9]+) \(([\s\S]*?)\n\);/g)) for (const c of m[2].matchAll(/^\s{4}([a-z_0-9]+)\s/gm)) add(m[1], c[1]);
  for (const f of fs.readdirSync(MIG).filter(f => f.endsWith(".sql") && !f.startsWith("000_")).sort()) {
    const t = fs.readFileSync(path.join(MIG, f), "utf8");
    for (const m of t.matchAll(/create table if not exists (?:public\.)?([a-z_0-9]+)\s*\(([\s\S]*?)\n\);/gi)) for (const c of m[2].matchAll(/^\s*([a-z_0-9]+)\s/gm)) add(m[1], c[1]);
    for (const m of t.matchAll(/alter table (?:public\.)?([a-z_0-9]+)((?:\s*add column (?:if not exists )?[a-z_0-9]+[^,;]*,?)+)/gi)) for (const c of m[2].matchAll(/add column (?:if not exists )?([a-z_0-9]+)/gi)) add(m[1], c[1]);
  }
}
const holds = (table, row, label) => {
  const cols = columns.get(table);
  expect(cols, `table ${table} is declared`).toBeTruthy();
  for (const k of Object.keys(row || {})) expect(cols.has(k), `${label}: ${table}.${k}`).toBe(true);
};

describe("C544 — row builders match their tables", () => {
  it("ar_invoices / ar_invoice_lines", () => {
    const { header, lines } = arInvoiceRows({ id: "x", customer: "Acme", invoice_number: "INV-1", date: "2026-09-01", due_date: "2026-10-01", status: "sent", line_items: [{ description: "Catering", qty: 1, rate: 100, amount: 100 }], tax_rate: 8.25 }, { companyId: "c", customerId: "k", userId: "u", taxAmount: 8.25 });
    holds("ar_invoices", header, "arInvoiceRows.header");
    for (const l of lines) holds("ar_invoice_lines", l, "arInvoiceRows.line");
  });
  it("vendor_rules / recurring_transactions", () => {
    holds("vendor_rules", buildVendorRuleRow({ companyId: "c", contactId: "k", accountId: "a", project: "P" }), "buildVendorRuleRow");
    holds("recurring_transactions", buildRecurringRow({ companyId: "c", name: "Rent", amount: 1, debitAccountId: "d", creditAccountId: "e", frequency: "monthly", nextDate: "2026-10-01", project: "P" }), "buildRecurringRow");
    holds("recurring_transactions", recurringRunPatch({ last_run: "2026-09-16", next_date: "2026-10-16" }), "recurringRunPatch");
  });
  it("bank_statements / bank_statement_lines", () => {
    holds("bank_statements", buildStatementRow({ companyId: "c", bankAccountId: "b", documentId: "d", periodStart: "2026-09-01", periodEnd: "2026-09-30", statedOpening: 1, statedEnding: 2, sourceFilename: "f.pdf", contentHash: "h" }), "buildStatementRow");
    for (const l of buildStatementLineRows([{ date: "2026-09-02", description: "x", amount: 5, direction: "out", raw: "x", running_balance: 1 }], { companyId: "c", statementId: "s" })) holds("bank_statement_lines", l, "buildStatementLineRows");
  });
  it("document_intake / unknown_documents / anomalies / vendor_state / accounts / companies", () => {
    holds("document_intake", buildIntakeRow({ companyId: "c", filename: "f", contentHash: "h", source: "upload", uploadedBy: "u", documentId: "d" }), "buildIntakeRow");
    const u = unknownDocRow({ id: "r", name: "f.pdf", document_type_detected: "menu", ai_explanation: "x", entry_needed: false, entry_summary: null, proposed_journal_entry: null, watch_for: [], watch_matches: [], posted: false, dismissed: false }, { companyId: "c", documentId: "d" });
    if (u) holds("unknown_documents", u, "unknownDocRow");
    holds("anomalies", anomalyInsertRow("c", { id: "a", type: "large_transaction", severity: "medium", title: "t", description: "d", vendor: "v", amount: 1, invoice_ids: [], fingerprint: "f", detected_at: new Date().toISOString() }), "anomalyInsertRow");
    holds("vendor_state", vendorStateRow({ entity_key: "k", tier: "STRANGER" }, { companyId: "c" }), "vendorStateRow");
    holds("accounts", buildAccountInsert({ companyId: "c", code: "6250", name: "Repairs", category: "Expenses", system_role: "repairs", origin: "seed" }), "buildAccountInsert");
    holds("companies", buildCompanyUpdate({ name: "Co", address: "1 St", phone: "1", email: "e", website: "w", taxId: "t", fiscalYearEnd: "12-31", stateOfIncorporation: "TX", entityType: "llc" }), "buildCompanyUpdate");
  });
});
