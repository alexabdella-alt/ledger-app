import { describe, it, expect } from "vitest";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { autoMatchBankLines, planBankImport } from "../src/lib/bankMatch.js";
import { glAccountBalance } from "../src/lib/reports.js";

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: the REAL upload→match→book data path (not the matcher in isolation).
// The unit tests fabricated open items with hand-picked fields; the live flow feeds
// autoMatchBankLines the output of flattenJournalEntries. This drives that real shape
// so a mismatch between what flatten produces and what the matcher reads can't
// regress silently again. Mirrors company 24d5e576: Acme (simple AR), Riverside
// (TAXED AR — revenue row carries ex-tax `amount` 1,200 but full receivable
// `ar_amount` 1,284), Globex (untouched AR), Pixel (AP bill). Target: all 3 bank
// lines match → AR clears to 6,800, AP to 0.
// ─────────────────────────────────────────────────────────────────────────────

const COA = [
  { code: "1100", name: "Accounts Receivable", category: "Assets",      system_role: "accounts_receivable" },
  { code: "2000", name: "Accounts Payable",    category: "Liabilities", system_role: "accounts_payable" },
  { code: "2350", name: "Sales Tax Payable",   category: "Liabilities" },
  { code: "4000", name: "Revenue",             category: "Revenue" },
  { code: "6800", name: "Professional Services", category: "Expenses" },
];
const acct = (code) => { const a = COA.find(x => x.code === code); return { code: a.code, name: a.name, category: a.category }; };
const line = (debit, credit, code) => ({ debit, credit, accounts: acct(code) });

// DB-shaped journal_entries exactly as loadAllData passes them to flattenJournalEntries.
const entries = [
  { id: "acme", description: "Acme Corp – Invoice 001", entry_date: "2026-05-01", source: "invoice", payment_status: "uncollected",
    journal_entry_lines: [ line(4500, 0, "1100"), line(0, 4500, "4000") ] },
  // Taxed invoice: Dr A/R 1,284 / Cr Revenue 1,200 / Cr Sales Tax 84 (C83 shape).
  { id: "riverside", description: "Riverside Cafe (Maria) – Invoice 002", entry_date: "2026-05-02", source: "invoice", payment_status: "uncollected",
    journal_entry_lines: [ line(1284, 0, "1100"), line(0, 1200, "4000"), line(0, 84, "2350") ] },
  { id: "globex", description: "Globex – Invoice 003", entry_date: "2026-05-03", source: "invoice", payment_status: "uncollected",
    journal_entry_lines: [ line(6800, 0, "1100"), line(0, 6800, "4000") ] },
  { id: "pixel", description: "Pixel Contractor LLC – Bill 004", entry_date: "2026-05-04", source: "upload", payment_status: "unpaid",
    journal_entry_lines: [ line(1800, 0, "6800"), line(0, 1800, "2000") ] },
];

// The bank statement, parsed/categorized as handleBankFile produces it.
const parsedTxns = [
  { id: "b0", vendor: "ACME CORP",        description: "ACME CORP INV PAYMENT",  date: "2026-06-10", amount: 4500, type: "revenue", gl_code: "4000", gl_name: "Revenue" },
  { id: "b1", vendor: "Riverside Cafe",   description: "RIVERSIDE CAFE PAYMENT", date: "2026-06-11", amount: 1284, type: "revenue", gl_code: "4000", gl_name: "Revenue" },
  { id: "b2", vendor: "Pixel Contractor", description: "PIXEL CONTRACTOR LLC",   date: "2026-06-12", amount: 1800, type: "expense", gl_code: "6800", gl_name: "Professional Services" },
];

const codes = { apCode: "2000", accruedCode: "2100", arCode: "1100", cashCode: "1000", cashName: "Cash" };
const clearRow = (c, i) => ({ id: `clr${i}`, date: c.date, amount: c.entry.amount, debit_credit: c.entry.debit_credit, gl_code: c.entry.gl_code, secondary_gl_code: c.entry.secondary_gl_code, status: "booked" });

describe("bank import — REAL flatten → match → book path (regression guard)", () => {
  const flat = flattenJournalEntries(entries, COA);
  // Exactly bookBankTransactions' open-items filter.
  const openItems = flat.filter(i =>
    !i.matched && i.payment_status !== "paid" && i.payment_status !== "collected" && i.source !== "bank_feed" && i.source !== "bank_statement");

  it("flatten produces the taxed invoice with ex-tax amount but full ar_amount (the shape that broke matching)", () => {
    const rivRev = flat.find(r => r.id === "riverside_1");  // the revenue row of the multi-line expansion
    expect(rivRev.type).toBe("revenue");
    expect(rivRev.amount).toBe(1200);       // ex-tax — what the naive matcher compared against
    expect(rivRev.ar_amount).toBe(1284);    // full receivable — what the bank deposit actually is
  });

  it("deterministic matcher matches ALL THREE against the real flattened shape", () => {
    const m = autoMatchBankLines(parsedTxns, openItems);
    expect(m).toHaveLength(3);
    const byBank = Object.fromEntries(m.map(x => [x.bank_txn_id, x.invoice_ids[0]]));
    expect(byBank.b0).toBe("acme");
    expect(byBank.b1).toBe("riverside_1");   // taxed invoice's revenue row, matched on ar_amount
    expect(byBank.b2).toBe("pixel");
  });

  it("end-to-end: all clear, nothing direct-booked, AR→6,800 and AP→0", () => {
    const autoCleared = autoMatchBankLines(parsedTxns, openItems);
    const plan = planBankImport({ parsedTxns, autoCleared, queue: [], openItems, codes });
    expect(plan.clears).toHaveLength(3);
    expect(plan.standalone).toHaveLength(0);   // ← the regression: these were all direct-booked

    const after = [...flat, ...plan.clears.map(clearRow)];
    expect(glAccountBalance("1100", after)).toBe(6800);   // AR: 12,584 − 4,500 − 1,284
    expect(glAccountBalance("2000", after)).toBe(0);       // AP: Pixel cleared
  });
});
