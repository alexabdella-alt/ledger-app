import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { executeAITool } from "../src/lib/aiTools.js";
import { flattenJournalEntries } from "../src/lib/ledger.js";

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

// C521 — a transaction is an ENTRY, not a line: a two-line bill is one search result at its total.
describe("C521 — search_transactions lists one row per entry", () => {
  const chart = [
    { code: "2000", name: "Accounts Payable", category: "Liabilities", system_role: "accounts_payable" },
    { code: "5010", name: "Food Cost", category: "Expenses" },
    { code: "5030", name: "Freight", category: "Expenses" },
  ];
  const acct = (code) => ({ code, name: chart.find(a => a.code === code)?.name });
  const je = (id, date, description, lines) => ({
    id, entry_date: date, description, status: "posted", deleted_at: null, source: "universal_upload", payment_status: "unpaid",
    journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: acct(l.code) })),
  });
  const ledger = flattenJournalEntries([
    je("big", "2026-09-03", "Sysco – produce + freight", [{ code: "5010", debit: 3000 }, { code: "5030", debit: 3000 }, { code: "2000", credit: 6000 }]),
    je("s", "2026-09-04", "Sysco – cheese", [{ code: "5010", debit: 400 }, { code: "2000", credit: 400 }]),
  ], chart);
  const ctx = { getLedger: async () => ledger, getAccountByRole: () => null };

  it("THE REPRO — the two-line bill is ONE transaction of $6,000, not three rows", async () => {
    expect(ledger.length).toBe(4);   // the shape under test: an expanded entry plus a simple one
    const r = await executeAITool("search_transactions", { vendor: "Sysco" }, ctx);
    expect(r.total_count).toBe(2);
    expect(r.total_amount).toBe(6400);
    const big = r.transactions.find(t => t.date === "2026-09-03");
    expect(big.amount).toBe(6000);
    expect(big.lines).toBe(3);   // the whole entry, with each line's side, so the model can tell what was bought from what is owed
    expect(big.line_items.map(l => `${l.gl_name}:${l.side}`)).toEqual(["Food Cost:debit", "Freight:debit", "Accounts Payable:credit"]);
    expect(r.transactions.find(t => t.date === "2026-09-04").lines).toBeUndefined();
  });

  it("'the $6,000 Sysco bill' is found by its total — and is not reported as an Accounts Payable row", async () => {
    const r = await executeAITool("search_transactions", { vendor: "Sysco", min_amount: 6000 }, ctx);
    expect(r.total_count).toBe(1);
    expect(r.transactions[0].gl_name).not.toBe("Accounts Payable");
  });

  it("a GL-code filter matches an entry carrying that code on ANY line, and totals only those lines", async () => {
    const r = await executeAITool("search_transactions", { vendor: "Sysco", gl_code: "5030" }, ctx);
    expect(r.total_count).toBe(1);
    expect(r.total_amount).toBe(3000);   // the Freight line, not the whole bill
  });
});

// C521 — the legacy (no-tools) prompt lists the ledger per ENTRY too. `runAIBrain` is network-bound,
// so this is held as structure: the section reads `perEntry(invoices)` and never slices the raw rows.
describe("C521 — the legacy prompt's ledger snapshot is per entry", () => {
  it("reads perEntry and not the expanded rows", () => {
    const src = fs.readFileSync("src/lib/ai.js", "utf8").replace(/\/\/.*$/gm, "");
    const at = src.indexOf("const legacyLedgerSection");
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(src.lastIndexOf("\n", src.indexOf("const ledgerEntries")), src.indexOf("const contactsSection", at));
    expect(block).toContain("perEntry(invoices)");
    expect(block).toContain("ledgerEntries.slice(0, 80)");
    expect(block).not.toMatch(/invoices\.slice\(/);
    expect(block).not.toMatch(/\$\$\{inv\.amount\}/);   // money through the formatter, not "$4000"
  });
});

// C539 — "how much with Hill Country" lists the payment that settled the bill under the
// supplier's name (kind: payment), not under a vendor called "Payment".
describe("C539 — the chat's search files a payment under the party it paid", () => {
  it("finds the payment by the supplier's name and reports its vendor as the supplier", async () => {
    const rows = [
      { id: "b", vendor: "Roma", description: "Roma – cheese", amount: 300, date: "2026-09-01", gl_code: "5010", secondary_gl_code: "2000", debit_credit: "debit", type: "expense", status: "booked", payment_status: "paid" },
      { id: "p", vendor: "Payment", description: "Payment – Roma", amount: 300, date: "2026-09-05", gl_code: "2000", secondary_gl_code: "1000", debit_credit: "debit", type: "expense", status: "booked", payment_status: "paid", import_metadata: { kind: "ap_payment", payment_for: "b" } },
    ];
    const r = await executeAITool("search_transactions", { vendor: "Roma" }, { getLedger: async () => rows, getAccountByRole: () => null });
    expect(r.total_count).toBe(2);
    expect(r.transactions.find(t => t.kind === "payment").vendor).toBe("Roma");
    expect(r.total_amount).toBe(300);   // the payment contributes nothing to spend (C486)
  });
});
