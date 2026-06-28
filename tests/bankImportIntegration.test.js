import { describe, it, expect } from "vitest";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { autoMatchBankLines, planBankImport } from "../src/lib/bankMatch.js";
import { glAccountBalance } from "../src/lib/reports.js";

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: the REAL upload→match→book data path (not the matcher in isolation),
// against the EXACT stored data for company 24d5e576 from the bug report. The matcher
// must key the clear SIDE on the A/R / A/P OFFSET CODE, never on a `type` string — a
// `type` that drifts from "revenue"/"expense" silently dropped Riverside/Pixel from the
// candidate set while Acme survived (the 1-of-3 live regression). Target: 3-of-3 →
// AR clears to 0 (all three AR invoices here are matched) and AP to 0.
// ─────────────────────────────────────────────────────────────────────────────

const COA = [
  { code: "1000", name: "Cash",                  category: "Assets",      system_role: "cash" },
  { code: "1100", name: "Accounts Receivable",   category: "Assets",      system_role: "accounts_receivable" },
  { code: "2000", name: "Accounts Payable",      category: "Liabilities", system_role: "accounts_payable" },
  { code: "4000", name: "Sales Revenue",         category: "Revenue" },
  { code: "4100", name: "Service Revenue",       category: "Revenue" },
  { code: "6800", name: "Professional Services", category: "Expenses" },
];
const acct = (code) => { const a = COA.find(x => x.code === code); return { code: a.code, name: a.name, category: a.category }; };
const ln = (debit, credit, code) => ({ debit, credit, accounts: acct(code) });
const matchCodes = { arCode: "1100", apCode: "2000" };
const codes = { apCode: "2000", accruedCode: "2100", arCode: "1100", cashCode: "1000", cashName: "Cash" };
const clearRow = (c, i) => ({ id: `clr${i}`, date: c.date, amount: c.entry.amount, debit_credit: c.entry.debit_credit, gl_code: c.entry.gl_code, secondary_gl_code: c.entry.secondary_gl_code, status: "booked" });

// EXACT stored shapes: Acme (Cr Rev 4000), Riverside (Cr Rev 4100, NOT taxed), Pixel (AP bill).
const entries = [
  { id: "acme-inv", description: "Acme Corp – Consulting", entry_date: "2026-05-01", source: "universal_upload", payment_status: "uncollected",
    journal_entry_lines: [ ln(4500, 0, "1100"), ln(0, 4500, "4000") ] },
  { id: "riverside-inv", description: "Riverside Cafe – Social media management retainer", entry_date: "2026-05-02", source: "universal_upload", payment_status: "uncollected",
    journal_entry_lines: [ ln(1284, 0, "1100"), ln(0, 1284, "4100") ] },
  { id: "pixel-bill", description: "Pixel Contractor LLC – Design work", entry_date: "2026-05-03", source: "universal_upload", payment_status: "unpaid",
    journal_entry_lines: [ ln(1800, 0, "6800"), ln(0, 1800, "2000") ] },
];
const parsedTxns = [
  { id: "b-acme", vendor: "Acme Corp",            description: "ACME CORP INV PAYMENT",  date: "2026-06-10", amount: 4500, type: "revenue", gl_code: "4000", gl_name: "Sales Revenue" },
  { id: "b-riv",  vendor: "Riverside Cafe",       description: "RIVERSIDE CAFE PAYMENT", date: "2026-06-11", amount: 1284, type: "revenue", gl_code: "4100", gl_name: "Service Revenue" },
  { id: "b-pix",  vendor: "Pixel Contractor LLC", description: "PIXEL CONTRACTOR LLC",   date: "2026-06-12", amount: 1800, type: "expense", gl_code: "6800", gl_name: "Professional Services" },
];

describe("bank import — REAL flatten → match → book path (company 24d5e576 data)", () => {
  const flat = flattenJournalEntries(entries, COA);
  const openItems = flat.filter(i =>
    !i.matched && i.payment_status !== "paid" && i.payment_status !== "collected" && i.source !== "bank_feed" && i.source !== "bank_statement");

  it("all 3 clear via the A/R-/A/P-offset key → AR=0, AP=0 (was 1-of-3)", () => {
    const autoCleared = autoMatchBankLines(parsedTxns, openItems, matchCodes);
    expect(autoCleared).toHaveLength(3);
    const plan = planBankImport({ parsedTxns, autoCleared, queue: [], openItems, codes });
    expect(plan.clears).toHaveLength(3);
    expect(plan.standalone).toHaveLength(0);
    const after = [...flat, ...plan.clears.map(clearRow)];
    expect(glAccountBalance("1100", after)).toBe(0);   // AR: 4,500 + 1,284 both collected
    expect(glAccountBalance("2000", after)).toBe(0);   // AP: Pixel paid
  });

  // THE REGRESSION: an item whose flattened/categorized `type` drifted away from the exact
  // "revenue"/"expense" strings. The old matcher filtered candidates on `type` and dropped
  // these; the offset-based matcher keys on the A/R / A/P code and still clears them.
  it("matches even when the open item's `type` is wrong/missing (offset code is the anchor)", () => {
    const drifted = openItems.map(i => ({ ...i, type: undefined }));   // simulate type drift
    const m = autoMatchBankLines(parsedTxns, drifted, matchCodes);
    expect(m).toHaveLength(3);
    expect(m.find(x => x.bank_txn_id === "b-riv").match_type).toBe("ar_clear");
    expect(m.find(x => x.bank_txn_id === "b-pix").match_type).toBe("ap_clear");
  });

  it("does NOT mistake a prior direct-booked deposit (Dr Cash / Cr Rev, offset=Cash) for an open A/R", () => {
    // A standalone bank deposit booked in an earlier run: revenue type, but its offset is
    // Cash (1000), not A/R — it must not be treated as a receivable a new deposit can clear.
    const priorDeposit = { id: "prior", vendor: "Riverside Cafe", amount: 1284, type: "revenue", gl_code: "4100", secondary_gl_code: "1000", payment_status: "uncollected" };
    const m = autoMatchBankLines(
      [{ id: "b", vendor: "Riverside Cafe", amount: 1284, type: "revenue" }],
      [priorDeposit, ...openItems], matchCodes);
    expect(m).toHaveLength(1);
    expect(m[0].invoice_ids).toEqual(["riverside-inv"]);   // the real invoice, not the prior cash deposit
  });
});
