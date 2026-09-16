import { describe, it, expect } from "vitest";
import { executeAITool } from "../src/lib/aiTools.js";

// ═════════════════════════════════════════════════════════════════════════════
// C486 — "HOW MUCH HAVE I SPENT WITH SYSCO?" ANSWERED $1,500 FOR A $500 BILL. The AI's
// search tool summed `amount` over every matching row: the bill, the payment that settled
// it (a row carrying the vendor's name), and a correction of it. Payments move no P&L;
// corrections subtract. The total is the signed P&L movement now, and each listed row says
// what kind of row it is.
// ═════════════════════════════════════════════════════════════════════════════
const rows = [
  { id: "b1", db_entry_id: "b1", vendor: "Sysco", amount: 500, date: "2026-09-01", gl_code: "5010", secondary_gl_code: "2000", type: "expense", debit_credit: "debit", status: "posted", payment_status: "paid" },
  { id: "p1", db_entry_id: "p1", vendor: "Sysco", amount: 500, date: "2026-09-05", gl_code: "2000", secondary_gl_code: "1000", type: "expense", debit_credit: "debit", status: "posted", import_metadata: { kind: "ap_payment", payment_for: "b1" } },
  // `reversed_by` as the flatten stamps it from the live correction (C468) — the AI's ledger comes through `fetchLedger` → flatten.
  { id: "b2", db_entry_id: "b2", vendor: "Sysco", amount: 200, date: "2026-09-08", gl_code: "5010", secondary_gl_code: "2000", type: "expense", debit_credit: "debit", status: "posted", reversed_by: "r2" },
  { id: "r2", db_entry_id: "r2", vendor: "Sysco", amount: 200, date: "2026-09-09", gl_code: "5010", secondary_gl_code: "2000", type: "expense", debit_credit: "credit", status: "posted", import_metadata: { kind: "reversal", reverses: "b2" } },
  { id: "s1", db_entry_id: "s1", vendor: "Acme", amount: 900, date: "2026-09-10", gl_code: "4000", secondary_gl_code: "1100", type: "revenue", debit_credit: "credit", status: "posted" },
];
const ctx = { getLedger: async () => rows };

describe("C486", () => {
  it("the vendor total is the signed spend — the payment adds nothing, the correction subtracts", async () => {
    const r = await executeAITool("search_transactions", { vendor: "Sysco" }, ctx);
    expect(r.total_count).toBe(4);
    expect(r.total_amount).toBe(500);
    expect(r.note_payments).toMatch(/1 of the matches are payments/);
    expect(r.transactions.map((t) => [t.id, t.kind]).sort()).toEqual([["b1", "entry"], ["b2", "entry"], ["p1", "payment"], ["r2", "correction"]].sort());
  });
  it("a revenue row counts positive", async () => {
    const r = await executeAITool("search_transactions", { vendor: "Acme" }, ctx);
    expect(r.total_amount).toBe(900);
    expect(r.note_payments).toBeUndefined();
  });
});

// C487 — get_overdue_invoices decided "open" from the paid flag alone, so a corrected bill
// (flag still unpaid, canceled by a correction) and a legacy bank line were listed as overdue.
describe("C487", () => {
  const ctx2 = { getLedger: async () => rows.map((r) => ({ ...r, due_date: "2026-08-01" })), getAccountByRole: () => null };
  it("a corrected bill is not overdue; a genuinely open one is", async () => {
    const r = await executeAITool("get_overdue_invoices", { type: "both" }, ctx2);
    const ids = r.invoices.map((x) => x.vendor + ":" + x.amount);
    expect(ids).not.toContain("Sysco:200");   // b2 — canceled by r2
    expect(ids).not.toContain("Sysco:500");   // b1 — paid (p1 settles it)
    expect(ids).toContain("Acme:900");        // an open receivable
  });
});

// C500 — the overdue tool reported a taxed invoice at its ex-tax revenue amount (the C454
// shape): a $1,299 invoice read as $1,200 owed in the chat's answer.
describe("C500", () => {
  it("an overdue taxed invoice is reported at the receivable, tax included", async () => {
    const taxed = { id: "t1", vendor: "Beta", amount: 1200, ar_amount: 1299, date: "2026-07-01", due_date: "2026-08-01", gl_code: "4000", secondary_gl_code: "1100", type: "revenue", status: "posted", payment_status: "unpaid" };
    const r = await executeAITool("get_overdue_invoices", { type: "ar" }, { getLedger: async () => [taxed], getAccountByRole: () => null });
    expect(r.invoices.map((x) => x.amount)).toEqual([1299]);
    expect(r.total).toBe(1299);
  });
});

// C501 — days_overdue was `now − new Date("YYYY-MM-DD")`, a UTC-midnight parse against a local
// clock: from any US zone an invoice due today read "1 day overdue" from 7 pm. Noon-anchored now.
describe("C501", () => {
  it("an invoice due today is not overdue at 7 pm local on its due date; it is the next afternoon", async () => {
    // The defect only shows from a zone BEHIND UTC (C290: CI runs UTC, where the mutation survives).
    process.env.TZ = "America/Chicago";
    expect(new Date("2026-08-01T12:00:00").getTimezoneOffset()).toBe(300);   // the zone change took, or this proves nothing
    const inv = { id: "d1", vendor: "Beta", amount: 100, date: "2026-07-01", due_date: "2026-08-01", gl_code: "4000", secondary_gl_code: "1100", type: "revenue", status: "posted", payment_status: "unpaid" };
    const ctx = { getLedger: async () => [inv], getAccountByRole: () => null };
    const at = (s) => ({ ...ctx, now: new Date(s) });
    const evening = await executeAITool("get_overdue_invoices", { type: "ar", days_overdue: 1 }, at("2026-08-01T19:00:00"));
    expect(evening.invoices).toHaveLength(0);
    const nextDay = await executeAITool("get_overdue_invoices", { type: "ar", days_overdue: 1 }, at("2026-08-02T13:00:00"));
    expect(nextDay.invoices.map((x) => x.days_overdue)).toEqual([1]);
  });
});
