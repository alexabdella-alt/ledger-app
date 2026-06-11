import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { computeAP, computeAR, agingReport } from "../src/lib/reports.js";
import { executeAITool } from "../src/lib/aiTools.js";

// ════════════════════════════════════════════════════════════════════════════
// CANONICAL PAYMENT STATE LOCK.
// One field — journal_entries.payment_status — means "paid" (AP) / "collected"
// (AR), surfaced by flattenJournalEntries. Marking a bill paid must remove it
// from EVERY unpaid surface at once, and must survive a flatten round-trip
// (the multi-line read-path bug that caused revert-on-refresh).
// ════════════════════════════════════════════════════════════════════════════

const YEAR = new Date().getFullYear();
const PAST_DUE = "2000-01-01";

const apBill = (over = {}) => ({
  id: "b1", vendor: "WeWork", amount: 1500, date: `${YEAR}-03-01`,
  gl_code: "6100", gl_name: "Rent & Occupancy", type: "expense",
  debit_credit: "debit", secondary_gl_code: "2000",
  payment_status: "unpaid", due_date: PAST_DUE, status: "booked", ...over,
});
const arInvoice = (over = {}) => ({
  id: "r1", vendor: "ClientCo", amount: 900, date: `${YEAR}-03-01`,
  gl_code: "4000", gl_name: "Service Revenue", type: "revenue",
  debit_credit: "credit", secondary_gl_code: "1200",
  payment_status: "unpaid", due_date: PAST_DUE, status: "booked", ...over,
});
const ctx = (rows) => ({ getLedger: async () => rows, cashBalance: "0", anomalies: [], recurring: [], getAccountByRole: () => null });

describe("a paid AP bill leaves every unpaid surface at once", () => {
  it("unpaid → counted everywhere", async () => {
    const rows = [apBill()];
    expect(computeAP(rows).total).toBe(1500);
    expect(computeAP(rows).count).toBe(1);
    expect(agingReport(rows, "ap").total).toBe(1500);
    const ai = await executeAITool("get_overdue_invoices", { type: "ap" }, ctx(rows));
    expect(ai.total).toBe(1500);
    const fin = await executeAITool("get_financial_summary", {}, ctx(rows));
    expect(fin.unpaid_ap_total).toBe(1500);
  });

  it("paid (canonical payment_status) → gone from all of them simultaneously", async () => {
    const rows = [apBill({ payment_status: "paid", paid_at: `${YEAR}-03-05T12:00:00Z`, payment_method_used: "ach" })];
    expect(computeAP(rows).total).toBe(0);
    expect(computeAP(rows).count).toBe(0);
    expect(agingReport(rows, "ap").total).toBe(0);
    const ai = await executeAITool("get_overdue_invoices", { type: "ap" }, ctx(rows));
    expect(ai.total).toBe(0);
    const fin = await executeAITool("get_financial_summary", {}, ctx(rows));
    expect(fin.unpaid_ap_total).toBe(0);
  });
});

describe("a collected AR invoice leaves every unpaid surface at once", () => {
  it("collected → gone from computeAR + aging + AI overdue", async () => {
    const open = [arInvoice()];
    expect(computeAR(open).total).toBe(900);
    expect(agingReport(open, "ar").total).toBe(900);

    const collected = [arInvoice({ payment_status: "collected", collected_at: `${YEAR}-03-05T12:00:00Z` })];
    expect(computeAR(collected).total).toBe(0);
    expect(agingReport(collected, "ar").total).toBe(0);
    const ai = await executeAITool("get_overdue_invoices", { type: "ar" }, ctx(collected));
    expect(ai.total).toBe(0);
  });
});

describe("paid state survives a flatten round-trip (the revert-on-refresh fix)", () => {
  const lines = (...ls) => ls.map(([debit, credit, code, name]) => ({ debit, credit, accounts: { code, name } }));

  it("simple 2-line bill: payment_status read back from the entry", () => {
    const entry = {
      id: "je-simple", entry_date: `${YEAR}-03-01`, status: "posted", deleted_at: null,
      payment_status: "paid", paid_at: `${YEAR}-03-05T12:00:00Z`, payment_method: "ach", source: "universal_upload",
      journal_entry_lines: lines([500, 0, "6500", "Software"], [0, 500, "2000", "Accounts Payable"]),
    };
    const rows = flattenJournalEntries([entry]);
    expect(rows[0].payment_status).toBe("paid");
    expect(rows[0].paid_at).toBe(`${YEAR}-03-05T12:00:00Z`);
    expect(computeAP(rows).total).toBe(0);
  });

  it("MULTI-LINE bill: every expense line reads back 'paid' (was hardcoded 'unpaid')", () => {
    const entry = {
      id: "je-multi", entry_date: `${YEAR}-03-01`, status: "posted", deleted_at: null,
      payment_status: "paid", paid_at: `${YEAR}-03-05T12:00:00Z`, payment_method: "ach", source: "universal_upload",
      journal_entry_lines: lines([600, 0, "6100", "Rent"], [400, 0, "6200", "Utilities"], [0, 1000, "2000", "Accounts Payable"]),
    };
    const rows = flattenJournalEntries([entry]);
    const expRows = rows.filter(r => r.gl_code === "6100" || r.gl_code === "6200");
    expect(expRows).toHaveLength(2);
    expRows.forEach(r => expect(r.payment_status).toBe("paid"));
    expect(computeAP(rows).total).toBe(0);   // paid → out of AP entirely
  });

  it("MULTI-LINE bill still UNPAID when the entry is unpaid (no false positives)", () => {
    const entry = {
      id: "je-multi-unpaid", entry_date: `${YEAR}-03-01`, status: "posted", deleted_at: null,
      due_date: PAST_DUE, source: "universal_upload",   // no payment_status → unpaid
      journal_entry_lines: lines([600, 0, "6100", "Rent"], [400, 0, "6200", "Utilities"], [0, 1000, "2000", "Accounts Payable"]),
    };
    const rows = flattenJournalEntries([entry]);
    rows.filter(r => r.gl_code?.startsWith("6")).forEach(r => expect(r.payment_status).toBe("unpaid"));
    expect(computeAP(rows).total).toBe(1000);
  });
});

describe("all 'mark paid' surfaces resolve to the one shared writer", () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const ap = read("../src/components/views/ApView.jsx");
  const rep = read("../src/components/views/ReportsView.jsx");
  const ar = read("../src/components/views/ArView.jsx");
  const books = read("../src/components/views/BooksView.jsx");

  it("the Payables button and the AP Aging button both call the shared markPaid", () => {
    expect(ap).toMatch(/markPaid\(/);
    expect(rep).toMatch(/markPaid\(/);
    expect(books).toMatch(/markPaid\(/);
  });
  it("AR 'Mark Collected' routes through the canonical writer (not local-only)", () => {
    expect(ar).toMatch(/markBillPaid\(/);
  });
  it("no view persists payment state on its own (single write path)", () => {
    for (const src of [ap, rep, ar, books]) {
      expect(src).not.toMatch(/persistApStatus/);
      expect(src).not.toMatch(/\.update\(\s*\{[^}]*payment_status/);
    }
  });
});
