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

// ─────────────────────────────────────────────────────────────────────────────
// THE 1-of-3 ROOT CAUSE: the candidate set was built from a payment_status FLAG, not
// GL truth. The three invoices WITH bank lines carried stale "collected"/"paid" flags
// (prior rounds' clearings were reversed/soft-deleted → A/R-A/P restored, flag left
// behind), so the old filter dropped them — only Meridian (never matched, clean flag)
// survived → live console `candidates: Array(1)`. matchableOpenItems keys on a LIVE
// clearing-JE link instead, so all four stay candidates.
// ─────────────────────────────────────────────────────────────────────────────
import { matchableOpenItems } from "../src/lib/bankMatch.js";

describe("matchableOpenItems — open from GL truth, not a stale payment_status flag", () => {
  // Flattened shape. Three are FLAGGED collected/paid but have NO live clearing JE.
  const flatInvoices = [
    { id: "acme-inv",      db_entry_id: "acme-inv",      vendor: "Acme Corp",            amount: 4500, type: "revenue", gl_code: "4000", secondary_gl_code: "1100", payment_status: "collected", source: "universal_upload" },
    { id: "riverside-inv", db_entry_id: "riverside-inv", vendor: "Riverside Cafe",       amount: 1284, type: "revenue", gl_code: "4100", secondary_gl_code: "1100", payment_status: "collected", source: "universal_upload" },
    { id: "pixel-bill",    db_entry_id: "pixel-bill",    vendor: "Pixel Contractor LLC", amount: 1800, type: "expense", gl_code: "6800", secondary_gl_code: "2000", payment_status: "paid",      source: "universal_upload" },
    { id: "meridian-inv",  db_entry_id: "meridian-inv",  vendor: "Meridian Group",       amount: 6800, type: "revenue", gl_code: "4000", secondary_gl_code: "1100", payment_status: "uncollected", source: "universal_upload" },
  ];

  it("the OLD flag-based filter drops the 3 with bank lines → only 1 candidate (the live bug)", () => {
    const oldFilter = flatInvoices.filter(i =>
      !i.matched && i.payment_status !== "paid" && i.payment_status !== "collected" && i.source !== "bank_feed" && i.source !== "bank_statement");
    expect(oldFilter).toHaveLength(1);
    expect(oldFilter[0].id).toBe("meridian-inv");
  });

  it("matchableOpenItems keeps ALL 4 (no live clearing JE links any of them)", () => {
    const open = matchableOpenItems(flatInvoices, { arCode: "1100", apCode: "2000" });
    expect(open.map(i => i.id).sort()).toEqual(["acme-inv", "meridian-inv", "pixel-bill", "riverside-inv"]);
  });

  it("a LIVE clearing JE (import_metadata.payment_for) DOES settle its item → excluded", () => {
    const withClearing = [
      ...flatInvoices,
      { id: "clr-acme", db_entry_id: "clr-acme", vendor: "Acme Corp", amount: 4500, type: "expense", gl_code: "1000", secondary_gl_code: "1100", source: "manual", status: "posted", import_metadata: { kind: "ar_payment", payment_for: "acme-inv" } },
    ];
    const open = matchableOpenItems(withClearing, { arCode: "1100", apCode: "2000" });
    expect(open.find(i => i.id === "acme-inv")).toBeUndefined();   // genuinely collected → out
    expect(open.find(i => i.id === "riverside-inv")).toBeTruthy(); // still open → in
  });

  it("a soft-deleted/voided clearing does NOT settle (item stays open)", () => {
    const withDeadClearing = [
      ...flatInvoices,
      { id: "clr-x", db_entry_id: "clr-x", vendor: "Riverside Cafe", source: "manual", deleted_at: "2026-06-01", import_metadata: { payment_for: "riverside-inv" } },
    ];
    const open = matchableOpenItems(withDeadClearing, { arCode: "1100", apCode: "2000" });
    expect(open.find(i => i.id === "riverside-inv")).toBeTruthy();   // reversed clearing → open again
  });

  it("end-to-end: matchableOpenItems candidate set → all 3 bank lines match", () => {
    const open = matchableOpenItems(flatInvoices, { arCode: "1100", apCode: "2000" });
    const parsed = [
      { id: "b-acme", vendor: "Acme Corp", amount: 4500, type: "revenue" },
      { id: "b-riv",  vendor: "Riverside Cafe", amount: 1284, type: "revenue" },
      { id: "b-pix",  vendor: "Pixel Contractor LLC", amount: 1800, type: "expense" },
    ];
    const m = autoMatchBankLines(parsed, open, { arCode: "1100", apCode: "2000" });
    expect(m).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE FLIP SIDE (silent disappearance): matched lines were excluded from direct-booking
// (correct) but their CLEARING JE never posted (bug) — markBillPaid gated the clearing on
// `payment_status !== newStatus`, and after the matchable-open-items fix a matched line
// legitimately carries a STALE collected/paid flag, so the gate skipped the post. The line
// cleared NOTHING and its cash movement vanished, while markBillPaid still returned success.
// Fix: post the clearing on GL truth (no LIVE clearing JE linked), never on the flag.
// This asserts the ACCOUNTING COMPLETENESS: 3 matched + 9 unmatched = 9 direct + 3 clearing
// = 12 bookings, AR→6,800, AP→0, and the matched lines DO move cash via their clearings.
// ─────────────────────────────────────────────────────────────────────────────
describe("bank import — matched lines CLEAR (no silent disappearance): 9 direct + 3 clearing = 12", () => {
  // Flattened invoices, with the stale collected/paid flags from the live state.
  const flatInvoices = [
    { id: "acme-inv",      db_entry_id: "acme-inv",      vendor: "Acme Corp",            amount: 4500, type: "revenue", gl_code: "4000", secondary_gl_code: "1100", debit_credit: "credit", status: "booked", payment_status: "collected",   source: "universal_upload" },
    { id: "riverside-inv", db_entry_id: "riverside-inv", vendor: "Riverside Cafe",       amount: 1284, type: "revenue", gl_code: "4100", secondary_gl_code: "1100", debit_credit: "credit", status: "booked", payment_status: "collected",   source: "universal_upload" },
    { id: "pixel-bill",    db_entry_id: "pixel-bill",    vendor: "Pixel Contractor LLC", amount: 1800, type: "expense", gl_code: "6800", secondary_gl_code: "2000", debit_credit: "debit",  status: "booked", payment_status: "paid",        source: "universal_upload" },
    { id: "meridian-inv",  db_entry_id: "meridian-inv",  vendor: "Meridian Group",       amount: 6800, type: "revenue", gl_code: "4000", secondary_gl_code: "1100", debit_credit: "credit", status: "booked", payment_status: "uncollected", source: "universal_upload" },
  ];
  const open = matchableOpenItems(flatInvoices, { arCode: "1100", apCode: "2000" });

  // 3 matchable bank lines + 9 unmatched (genuinely-new misc expenses).
  const matched = [
    { id: "b-acme", vendor: "Acme Corp",            amount: 4500, type: "revenue", gl_code: "4000" },
    { id: "b-riv",  vendor: "Riverside Cafe",       amount: 1284, type: "revenue", gl_code: "4100" },
    { id: "b-pix",  vendor: "Pixel Contractor LLC", amount: 1800, type: "expense", gl_code: "6800" },
  ];
  const unmatched = Array.from({ length: 9 }, (_, i) => ({ id: `u${i}`, vendor: `Misc ${i}`, amount: 100 + i, type: "expense", gl_code: "6500" }));
  const parsedTxns = [...matched, ...unmatched];

  const autoCleared = autoMatchBankLines(parsedTxns, open, { arCode: "1100", apCode: "2000" });
  const plan = planBankImport({ parsedTxns, autoCleared, queue: [], openItems: open, codes });

  it("partitions into 3 clearings + 9 standalone = 12 bookings (none vanish)", () => {
    expect(autoCleared).toHaveLength(3);
    expect(plan.clears).toHaveLength(3);       // matched → clearing JE (NOT dropped)
    expect(plan.standalone).toHaveLength(9);   // unmatched → direct
    expect(plan.clears.length + plan.standalone.length).toBe(12);
  });

  it("every clearing builds a real balanced JE (the step that silently posted nothing)", () => {
    for (const c of plan.clears) {
      expect(c.entry).toBeTruthy();                                  // buildPaymentEntry produced an entry
      expect(c.entry.amount).toBeGreaterThan(0);
      expect([c.entry.gl_code, c.entry.secondary_gl_code]).toContain("1000");  // cash leg present
    }
  });

  it("AR clears to 6,800 and AP to 0 (Acme+Riverside collected, Pixel paid; Meridian still open)", () => {
    const after = [...flatInvoices, ...plan.clears.map(clearRow)];
    expect(glAccountBalance("1100", after)).toBe(6800);
    expect(glAccountBalance("2000", after)).toBe(0);
  });

  it("the 3 matched lines DO move cash via their clearings (+4,500 +1,284 −1,800 = +3,984)", () => {
    const cashFromClearings = glAccountBalance("1000", plan.clears.map(clearRow));
    expect(cashFromClearings).toBe(3984);   // before the fix this was 0 — the lines vanished
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LOOP/RESULTS PROOF: the matcher iterates EVERY bank line independently and records
// each outcome. The [bank-match] trace gives a per-line verdict (matched→which item, or
// the precise reason it didn't) so a live miss is self-explaining — and it proves the
// loop matches all 3 on the exact-name+amount case, not 1.
// ─────────────────────────────────────────────────────────────────────────────
describe("autoMatchBankLines — per-line results trace (loop matches ALL, not just the first)", () => {
  const open = [
    { id: "acme-inv",      vendor: "Acme Corporation",     amount: 4500, type: "revenue", gl_code: "4000", secondary_gl_code: "1100" }, // fuzzy name
    { id: "riverside-inv", vendor: "Riverside Cafe",       amount: 1284, type: "revenue", gl_code: "4100", secondary_gl_code: "1100" }, // exact
    { id: "pixel-bill",    vendor: "Pixel Contractor LLC", amount: 1800, type: "expense", gl_code: "6800", secondary_gl_code: "2000" }, // exact
    { id: "meridian-inv",  vendor: "Meridian Group",       amount: 6800, type: "revenue", gl_code: "4000", secondary_gl_code: "1100" }, // no bank line
  ];
  const bankLines = [
    { id: "b-acme", vendor: "Acme Corp",            amount: 4500, type: "revenue" },
    { id: "b-riv",  vendor: "Riverside Cafe",       amount: 1284, type: "revenue" },
    { id: "b-pix",  vendor: "Pixel Contractor LLC", amount: 1800, type: "expense" },
  ];

  it("trace shows ✓ for ALL 3 (Acme fuzzy + Riverside/Pixel exact) — not 1-of-3", () => {
    const trace = [];
    const m = autoMatchBankLines(bankLines, open, { arCode: "1100", apCode: "2000", trace });
    expect(m).toHaveLength(3);
    expect(trace.filter(r => r.matched)).toHaveLength(3);
    expect(trace.find(r => r.bank === "b-acme")).toMatchObject({ matched: true, invoiceId: "acme-inv", side: "ar" });
    expect(trace.find(r => r.bank === "b-riv")).toMatchObject({ matched: true, invoiceId: "riverside-inv", side: "ar" });
    expect(trace.find(r => r.bank === "b-pix")).toMatchObject({ matched: true, invoiceId: "pixel-bill", side: "ap" });
  });

  it("a later line still matches after an earlier one did (no short-circuit / no consume-all)", () => {
    // Reverse order + an extra leading no-match line: every real line must still match.
    const trace = [];
    const m = autoMatchBankLines(
      [{ id: "noise", vendor: "Unknown Vendor", amount: 999, type: "expense" }, ...bankLines.slice().reverse()],
      open, { arCode: "1100", apCode: "2000", trace });
    expect(m).toHaveLength(3);
    expect(trace.find(r => r.bank === "noise").matched).toBe(false);
  });

  it("the reason diagnostic pinpoints WHY a line misses (amount off by a cent)", () => {
    const trace = [];
    autoMatchBankLines([{ id: "x", vendor: "Riverside Cafe", amount: 1283, type: "revenue" }], open, { arCode: "1100", apCode: "2000", trace });
    expect(trace[0].matched).toBe(false);
    expect(trace[0].reason).toMatch(/no candidate amount/);
  });
});
