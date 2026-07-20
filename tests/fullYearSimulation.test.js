import { describe, it, expect } from "vitest";

// ════════════════════════════════════════════════════════════════════════════
// O59 FULL-YEAR END-TO-END SIMULATION — the capstone verification.
//
// A synthetic company with a FULL YEAR of transactions AND a hand-computed KNOWN
// ANSWER KEY, run through the REAL production compute layer (reports.js,
// controlTotals.js, ledger.js flatten, depreciation.js, the payment / opening /
// revenue builders — NOT test doubles), asserting every output matches the answer
// key to the penny. Proves the books tie out across a year with every edge case
// that broke during the code review.
//
// THE SYNTHETIC YEAR deliberately includes each bug-class we fixed:
//   • normal revenue + expense across all 12 months (baseline volume, 1080 sales)
//   • a VOID/REVERSAL of a booked entry              → CR-1 (P&L nets to 0, not double)
//   • a REFUND / credit memo (Dr Revenue)            → CR-2 (revenue reduces, not force-credited)
//   • SALES TAX on AR invoices                       → Riverside control-total tie
//   • an ACCRUAL: bill booked month N, paid N+1      → AR/AP lifecycle across boundary
//   • DEPRECIATION on a Jan-31 in-service date       → CR-4 (Feb not skipped, no overflow)
//   • 1120 journal entries                           → CR-14 (whole ledger loads, no truncation)
//   • month / year-boundary dates (…-01-31, …-12-31) → the TZ / period-boundary class
//   • a completed BANK RECONCILIATION for part of yr → cash-cleared control total + green panel
//
// The ANSWER KEY below is computed FROM FIRST PRINCIPLES (plain arithmetic over the
// generation parameters) — never by calling the functions under test. The tests
// assert the REAL functions reproduce it exactly.
// ════════════════════════════════════════════════════════════════════════════

import { DEFAULT_CHART_OF_ACCOUNTS } from "../src/lib/constants.js";
import { flattenJournalEntries, fetchLedger } from "../src/lib/ledger.js";
import {
  computeRevenue, computeExpenses, computeNetIncome,
  computeAR, computeAP, glAccountBalance, glCashOnHand,
  trialBalance, fiscalYearSplit,
} from "../src/lib/reports.js";
import {
  computeControlTotals, evaluateSignOff, signOffReadiness, bankMatchStatus,
} from "../src/lib/controlTotals.js";
import { flaggedForReview } from "../src/lib/confidenceFlag.js";
import { buildOpeningBalanceEntry } from "../src/lib/openingBalances.js";
import { buildJournalEntry, reverseEntryLines } from "../src/lib/journalEntries.js";
import { buildArInvoiceEntry } from "../src/lib/revenueEntries.js";
import { buildPaymentEntry, paymentEntryLines } from "../src/lib/payments.js";
import { buildDepreciationSchedule } from "../src/lib/depreciation.js";

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const nameOf = code => (DEFAULT_CHART_OF_ACCOUNTS.find(a => a.code === code)?.name) || code;

// Default-COA codes this simulation touches.
const C = {
  cash: "1000", savings: "1010", ar: "1100", fixedAssets: "1500", accumDep: "1510",
  ap: "2000", salesTax: "2350", obe: "3400", retainedEarnings: "3100",
  serviceRev: "4100", rent: "6100", saas: "6500", depExp: "6900",
};
const COMPANY_ID = "co-sim-1";
const FYE = "12-31", CUTOFF = "2026-01-01", YEAR = "2026";
const YEAR_END = "2026-12-31";
const NOW = new Date("2026-07-15T12:00:00Z");   // fixed "today" so freshness/overdue are deterministic

// ── GENERATION PARAMETERS (the answer key derives from THESE, by hand) ────────
const OPENING_CASH   = 100000;
const RENT           = 5000;                 // × 12 months
const SALE_AMT       = 100;
const SALES_PER_MONTH = 90;                  // × 12 = 1080 cash sales
const VOID_AMT       = 3000;                 // booked then reversed → nets to 0
const REFUND         = 1200;                 // Dr Revenue (credit memo)
const INV_SUB        = 2000, TAX_RATE = 0.08; // AR invoice ex-tax + 8% tax
const INV_TAX        = r2(INV_SUB * TAX_RATE);        // 160
const INV_TOTAL      = r2(INV_SUB + INV_TAX);         // 2160
const INV_COUNT      = 5, INV_COLLECTED = 3;          // 3 collected, 2 open
const AP_BILL_PAID   = 4000;                 // booked Jul, paid Aug (accrual across boundary)
const AP_BILL_OPEN   = 2500;                 // booked Dec, unpaid at year end
const ASSET_COST     = 12000, ASSET_LIFE = 60;        // straight-line 60 mo → $200/mo
const MONTHLY_DEP    = r2(ASSET_COST / ASSET_LIFE);   // 200
const DEP_MONTHS_2026 = 12;                  // Jan-31 in service → 12 periods land in 2026

// ── THE ANSWER KEY (hand-computed, first principles) ──────────────────────────
const CASH_SALES_TOTAL = SALES_PER_MONTH * 12 * SALE_AMT;   // 108,000
const KEY = {
  totalRevenue:  r2(CASH_SALES_TOTAL - REFUND + INV_COUNT * INV_SUB),          // 116,800
  totalExpenses: r2(RENT * 12 + AP_BILL_PAID + AP_BILL_OPEN + MONTHLY_DEP * DEP_MONTHS_2026), // 68,900
  get netIncome() { return r2(this.totalRevenue - this.totalExpenses); },      // 47,900
  endingCash:    r2(OPENING_CASH - RENT * 12 + CASH_SALES_TOTAL - REFUND
                    + INV_COLLECTED * INV_TOTAL - AP_BILL_PAID - ASSET_COST),  // 137,280
  arBalance:     r2((INV_COUNT - INV_COLLECTED) * INV_TOTAL),                  // 4,320
  apBalance:     r2(AP_BILL_OPEN),                                             // 2,500
  salesTaxPayable: r2(INV_COUNT * INV_TAX),                                    // 800
  totalLiabilities: r2(AP_BILL_OPEN + INV_COUNT * INV_TAX),                    // 3,300
  totalEquityExclNet: r2(OPENING_CASH),                                        // 100,000 (OBE), RE 0
  get totalAssets() {                                                          // 151,200
    return r2(this.endingCash + this.arBalance + ASSET_COST - MONTHLY_DEP * DEP_MONTHS_2026);
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// SYNTHETIC-YEAR BUILDER — every entry is produced through a REAL builder where
// one exists, then converted to the journal_entries DB shape that flatten reads.
// ═══════════════════════════════════════════════════════════════════════════
const LAST_DAY = { "01": 31, "02": 28, "03": 31, "04": 30, "05": 31, "06": 30, "07": 31, "08": 31, "09": 30, "10": 31, "11": 30, "12": 31 };
let _id = 0;
const uid = p => `${p}-${String(++_id).padStart(5, "0")}`;

// journal_entries row (as fetchLedgerEntries returns it): top-level columns flatten
// reads + import_metadata jsonb + nested lines with accounts{code,name}.
function dbEntry({ id, date, source = "manual", description = "", lines, payment_status = null, due_date = null, import_metadata = null, ai_confidence = null }) {
  return {
    id, company_id: COMPANY_ID, entry_date: date, description, source,
    status: "posted", deleted_at: null,
    payment_status, due_date, ai_confidence, ai_reasoning: null,
    created_at: `${date}T12:00:00Z`, import_metadata,
    journal_entry_lines: lines.map(l => ({
      debit: r2(l.debit || 0), credit: r2(l.credit || 0), project: l.project || null,
      accounts: { code: l.code, name: nameOf(l.code) },
    })),
  };
}
// Convert a builder result ({lines:[{code,debit,credit}], date, source}) to a DB row.
const fromBuilt = (built, extra = {}) =>
  dbEntry({ id: extra.id || uid("e"), date: built.date, source: built.source, lines: built.lines, ...extra });

function buildSyntheticYear() {
  const entries = [];

  // 1) OPENING BALANCES (event #6/#7) — one balanced entry as of the cutoff.
  //    Cash 100,000 → Opening Balance Equity 100,000. (Real builder.)
  const opening = buildOpeningBalanceEntry({ [C.cash]: OPENING_CASH }, { cutoffDate: CUTOFF, obeCode: C.obe });
  entries.push(fromBuilt(opening, { id: "OPENING", description: "Opening balances" }));

  // 2) MONTHLY RENT — Dr Rent / Cr Cash, first of each month (baseline expense).
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    entries.push(dbEntry({
      id: uid("rent"), date: `${YEAR}-${mm}-01`, source: "manual", description: `Landlord – Rent ${mm}`,
      lines: [{ code: C.rent, debit: RENT, credit: 0 }, { code: C.cash, debit: 0, credit: RENT }],
      payment_status: "paid",   // cash-settled at booking — not an open payable
    }));
  }

  // 3) 1080 CASH SALES — Dr Cash / Cr Service Revenue. Dates cycle through a pattern
  //    that always includes the 1st AND the true last day of each month, so month/
  //    year boundary dates (…-01-31, …-12-31) are exercised every month (TZ class).
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    const pattern = [1, 5, 10, 15, 20, 25, LAST_DAY[mm]];
    for (let k = 0; k < SALES_PER_MONTH; k++) {
      const dd = String(pattern[k % pattern.length]).padStart(2, "0");
      entries.push(dbEntry({
        id: uid("sale"), date: `${YEAR}-${mm}-${dd}`, source: "manual", description: `Walk-in – Sale`,
        lines: [{ code: C.cash, debit: SALE_AMT, credit: 0 }, { code: C.serviceRev, debit: 0, credit: SALE_AMT }],
        payment_status: "collected",   // cash sale settled at the till — not an open receivable
      }));
    }
  }

  // 4) VOID / REVERSAL (event #14, CR-1) — a booked SaaS expense, then a GAAP
  //    reversal (offsetting entry via the real reverseEntryLines builder). The
  //    original stays LIVE (audit trail); the pair must NET to zero, not double.
  const voidOrig = buildJournalEntry({
    lines: [{ code: C.saas, debit: VOID_AMT, credit: 0 }, { code: C.cash, debit: 0, credit: VOID_AMT }],
    date: "2026-03-10", source: "manual", description: "Acme SaaS – erroneous charge",
  });
  const origId = "VOID-ORIG";
  entries.push(fromBuilt(voidOrig, { id: origId, description: "Acme SaaS – erroneous charge", payment_status: "paid" }));
  entries.push(dbEntry({
    id: uid("rev"), date: "2026-03-11", source: "manual", description: "Reversal – Acme SaaS erroneous charge",
    lines: reverseEntryLines(voidOrig.lines),   // Dr Cash / Cr SaaS — the mirror
    import_metadata: { reverses: origId }, payment_status: "paid",
  }));

  // 5) REFUND / CREDIT MEMO (CR-2) — Dr Service Revenue / Cr Cash. A Dr-Revenue leg
  //    must SUBTRACT from revenue (not be force-credited back up).
  entries.push(dbEntry({
    id: uid("refund"), date: "2026-04-15", source: "manual", description: "Customer refund – returned service",
    lines: [{ code: C.serviceRev, debit: REFUND, credit: 0 }, { code: C.cash, debit: 0, credit: REFUND }],
    payment_status: "collected",   // cash refund settled — not an open receivable
  }));

  // 6) SALES-TAX AR INVOICES (event #4/#16, Riverside) — Dr A/R / Cr Revenue / Cr
  //    Sales Tax Payable via the real buildArInvoiceEntry. 5 issued; 3 collected
  //    (Dr Cash / Cr A/R via the real buildPaymentEntry), 2 left open at year end.
  const invIds = [];
  for (let n = 0; n < INV_COUNT; n++) {
    const collected = n < INV_COLLECTED;
    const issueDate = `2026-05-${String(3 + n).padStart(2, "0")}`;
    const built = buildArInvoiceEntry({
      subtotal: INV_SUB, taxRate: TAX_RATE, arCode: C.ar, revenueCode: C.serviceRev,
      salesTaxCode: C.salesTax, date: issueDate, customer: `Client ${n + 1}`, invoiceNumber: `INV-${n + 1}`,
      dueDate: `2026-06-${String(3 + n).padStart(2, "0")}`,
    });
    const invId = `ARINV-${n + 1}`;
    invIds.push(invId);
    entries.push(fromBuilt(built, {
      id: invId, description: `Client ${n + 1} – Invoice INV-${n + 1}`,
      payment_status: collected ? "collected" : "uncollected",
      due_date: `2026-06-${String(3 + n).padStart(2, "0")}`,
      import_metadata: { kind: "ar_invoice", tax_amount: INV_TAX },   // persist path stores tax_amount here
    }));
    if (collected) {
      // Collect the FULL incl-tax balance next month (AR lifecycle across boundary).
      const pay = buildPaymentEntry(
        { secondary_gl_code: C.ar, ar_amount: INV_TOTAL, amount: INV_TOTAL, vendor: `Client ${n + 1}` },
        "ar", { arCode: C.ar, cashCode: C.cash, cashName: nameOf(C.cash), date: `2026-06-${String(20 + n).padStart(2, "0")}`, billDbId: invId },
      );
      entries.push(dbEntry({
        id: uid("arcollect"), date: pay.date, source: "manual", description: pay.description,
        lines: paymentEntryLines(pay), import_metadata: { kind: "ar_collection", payment_for: invId },
      }));
    }
  }

  // 7) ACCRUAL — AP bill booked in July, PAID in August (across the month boundary).
  //    Dr SaaS / Cr A/P at booking; Dr A/P / Cr Cash at payment (real buildPaymentEntry).
  const billPaidId = "APBILL-PAID";
  entries.push(dbEntry({
    id: billPaidId, date: "2026-07-20", source: "manual", description: "Cloud Inc – July hosting",
    lines: [{ code: C.saas, debit: AP_BILL_PAID, credit: 0 }, { code: C.ap, debit: 0, credit: AP_BILL_PAID }],
    payment_status: "paid", due_date: "2026-08-19",
  }));
  const apPay = buildPaymentEntry(
    { secondary_gl_code: C.ap, amount: AP_BILL_PAID, vendor: "Cloud Inc" },
    "ap", { apCode: C.ap, cashCode: C.cash, cashName: nameOf(C.cash), date: "2026-08-05", billDbId: billPaidId },
  );
  entries.push(dbEntry({
    id: uid("appay"), date: apPay.date, source: "manual", description: apPay.description,
    lines: paymentEntryLines(apPay), import_metadata: { kind: "ap_payment", payment_for: billPaidId },
  }));
  // A second bill booked in December, left UNPAID → open A/P at year end.
  entries.push(dbEntry({
    id: "APBILL-OPEN", date: "2026-12-15", source: "manual", description: "Cloud Inc – December hosting",
    lines: [{ code: C.saas, debit: AP_BILL_OPEN, credit: 0 }, { code: C.ap, debit: 0, credit: AP_BILL_OPEN }],
    payment_status: "unpaid", due_date: "2027-01-14",
  }));

  // 8) DEPRECIATION (event #8, CR-4) — buy an asset placed in service Jan 31, then
  //    the REAL straight-line schedule. The Jan-31 in-service date must clamp each
  //    period to the month's last day (Feb 28, never overflow to Mar 3) and NOT skip
  //    February. Post every 2026 period ($200 × 12).
  entries.push(dbEntry({
    id: "ASSET-BUY", date: "2026-01-31", source: "manual", description: "Equipment purchase",
    lines: [{ code: C.fixedAssets, debit: ASSET_COST, credit: 0 }, { code: C.cash, debit: 0, credit: ASSET_COST }],
  }));
  const schedule = buildDepreciationSchedule({
    cost: ASSET_COST, salvage: 0, lifeMonths: ASSET_LIFE, inServiceDate: "2026-01-31",
    depExpCode: C.depExp, accumDepCode: C.accumDep, assetLabel: "Equipment", assetId: "fa-1",
  });
  const dep2026 = schedule.entries.filter(e => String(e.date) <= YEAR_END);
  for (const de of dep2026) {
    entries.push(fromBuilt(de, { id: uid("dep"), description: de.description, import_metadata: de.meta, payment_status: "paid" }));
  }

  // ── Bank reconciliation completed for the first half of the year (July 10),
  //    matched (books === statement at recon time). Recent vs NOW → panel green.
  const midYearCash = glCashOnHand(flattenJournalEntries(entries, DEFAULT_CHART_OF_ACCOUNTS), [C.cash], { asOf: "2026-06-30" });
  const reconciliations = [{
    id: "recon-h1", status: "complete", account_name: "Operating Cash", period_end: "2026-06-30",
    books_balance: midYearCash, statement_balance: midYearCash, completed_at: "2026-07-10T00:00:00Z",
  }];

  // ── Intake rows: two documents marked RECORDED, each with a real journal entry
  //    behind it (so the sixth control total — docs-recorded — is present and ties).
  const intakeRows = [
    { id: "intake-1", status: "recorded", journal_entry_ids: [invIds[0]] },
    { id: "intake-2", status: "recorded", journal_entry_ids: [billPaidId] },
  ];

  return { entries, reconciliations, intakeRows, schedule };
}

// A minimal in-memory Supabase that supports the exact query chain fetchLedgerEntries
// uses, paging through range() — so the REAL pager (CR-14) runs over 1000+ entries.
function mockSupabase(entries) {
  return {
    from() {
      let rows = entries.slice();
      const b = {
        select: () => b,
        eq: (col, val) => { rows = rows.filter(r => String(r[col] ?? "") === String(val)); return b; },
        is: (col, val) => { rows = rows.filter(r => (val === null ? r[col] == null : r[col] === val)); return b; },
        order: () => b,
        range: (from, to) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
      };
      return b;
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
const YEAR_DATA = buildSyntheticYear();
const INVOICES = flattenJournalEntries(YEAR_DATA.entries, DEFAULT_CHART_OF_ACCOUNTS);
const TOTAL_ENTRIES = YEAR_DATA.entries.length;
const codes = { ar: C.ar, ap: C.ap, salesTax: C.salesTax };
const CONTROL = computeControlTotals({ invoices: INVOICES, reconciliations: YEAR_DATA.reconciliations, intakeRows: YEAR_DATA.intakeRows, codes, now: NOW });

// GL-truth category sums (the balance sheet's own basis).
const sumCategory = cat => r2(DEFAULT_CHART_OF_ACCOUNTS.filter(a => a.category === cat)
  .reduce((s, a) => s + glAccountBalance(a.code, INVOICES), 0));
const GL_ASSETS = sumCategory("Assets");
const GL_LIAB = sumCategory("Liabilities");
const GL_EQUITY = sumCategory("Equity");
const GL_NET = computeNetIncome(INVOICES);   // all-time

describe("O59 full-year simulation — the year's shape", () => {
  it("has 1120 journal entries (crosses 1000+, no truncation target)", () => {
    expect(TOTAL_ENTRIES).toBe(1120);
    expect(TOTAL_ENTRIES).toBeGreaterThan(1000);
  });
  it("includes the opening balance entry", () => {
    expect(YEAR_DATA.entries.some(e => e.source === "opening_balance")).toBe(true);
  });
});

describe("1 · P&L — computeRevenue/Expenses/NetIncome === answer key (void nets to zero)", () => {
  it(`revenue === $${KEY.totalRevenue.toLocaleString()}`, () => expect(computeRevenue(INVOICES)).toBe(KEY.totalRevenue));
  it(`expenses === $${KEY.totalExpenses.toLocaleString()}`, () => expect(computeExpenses(INVOICES)).toBe(KEY.totalExpenses));
  it(`net income === $${KEY.netIncome.toLocaleString()}`, () => expect(computeNetIncome(INVOICES)).toBe(KEY.netIncome));
  it("the void/reversal pair nets to zero in the SaaS account (CR-1, not doubled)", () => {
    // Only the void pair + AP SaaS bills touch 6500. Isolate the void pair by its dates.
    const voidPair = INVOICES.filter(i => i.date === "2026-03-10" || i.date === "2026-03-11");
    expect(glAccountBalance(C.saas, voidPair)).toBe(0);
  });
  it("the refund reduces revenue (CR-2: Dr Revenue subtracts, not force-credited)", () => {
    const withRefund = computeRevenue(INVOICES);
    const withoutRefund = computeRevenue(INVOICES.filter(i => i.vendor !== "Customer refund"));
    expect(r2(withoutRefund - withRefund)).toBe(REFUND);   // removing the refund RAISES revenue by $1,200
  });
});

describe("2 · Balance Sheet balances — assets === liabilities + equity + net income (to the penny)", () => {
  it("the accounting equation holds on the full year", () => {
    expect(GL_ASSETS).toBe(r2(GL_LIAB + GL_EQUITY + GL_NET));
  });
  it("total assets === answer key", () => expect(GL_ASSETS).toBe(KEY.totalAssets));
  it("total liabilities === answer key", () => expect(GL_LIAB).toBe(KEY.totalLiabilities));
  it("total equity (excl. current net) === answer key", () => expect(GL_EQUITY).toBe(KEY.totalEquityExclNet));
});

describe("3 · Income Statement ties to Balance Sheet (net income flows to retained earnings)", () => {
  const split = fiscalYearSplit(INVOICES, { asOf: YEAR_END, fiscalYearEnd: FYE, cutoffDate: CUTOFF });
  it("all activity is the current fiscal year (prior net === 0)", () => expect(split.priorNet).toBe(KEY.priorNet ?? 0));
  it("current-period net === net income === answer key", () => {
    expect(split.currentNet).toBe(KEY.netIncome);
    expect(split.currentNet).toBe(computeNetIncome(INVOICES, { to: YEAR_END }));
  });
  it("net income closes the balance-sheet gap exactly", () => {
    expect(r2(GL_ASSETS - (GL_LIAB + GL_EQUITY))).toBe(KEY.netIncome);
  });
});

describe("4 · Cash — ending cash === answer key via the cash-leg basis", () => {
  it(`glCashOnHand === $${KEY.endingCash.toLocaleString()}`, () => {
    expect(glCashOnHand(INVOICES, [C.cash, C.savings])).toBe(KEY.endingCash);
  });
  it("the cash GL account equals the cash-on-hand figure (single source)", () => {
    expect(glAccountBalance(C.cash, INVOICES)).toBe(KEY.endingCash);
  });
});

describe("5 · AR / AP sub-ledgers === their GL balances (control totals tie)", () => {
  it(`AR sub-ledger === GL A/R === $${KEY.arBalance.toLocaleString()}`, () => {
    expect(computeAR(INVOICES, { now: NOW }).total).toBe(KEY.arBalance);
    expect(glAccountBalance(C.ar, INVOICES)).toBe(KEY.arBalance);
  });
  it(`AP sub-ledger === GL A/P === $${KEY.apBalance.toLocaleString()}`, () => {
    expect(computeAP(INVOICES, { now: NOW }).total).toBe(KEY.apBalance);
    expect(glAccountBalance(C.ap, INVOICES)).toBe(KEY.apBalance);
  });
  it(`sales tax charged === GL Sales-Tax-Payable === $${KEY.salesTaxPayable.toLocaleString()}`, () => {
    expect(glAccountBalance(C.salesTax, INVOICES)).toBe(KEY.salesTaxPayable);
  });
});

describe("6 · ALL SIX control totals TIE on the correctly-booked year", () => {
  it("computeControlTotals → allTie, no failures", () => {
    expect(CONTROL.allTie).toBe(true);
    expect(CONTROL.failed).toHaveLength(0);
  });
  it("all six checks are present and each ties", () => {
    const keys = CONTROL.checks.map(c => c.key).sort();
    expect(keys).toEqual(["ap_tie", "ar_tie", "cash_recon", "docs_recorded", "sales_tax_tie", "trial_balance"]);
    for (const c of CONTROL.checks) expect(c.ties).toBe(true);
  });
  it("the trial balance itself is balanced (debits === credits)", () => {
    const tb = trialBalance(INVOICES);
    expect(tb.balanced).toBe(true);
    expect(tb.difference).toBe(0);
  });
});

describe("7 · The full ledger loads — all 1120 entries, opening balance present (CR-14, no truncation)", () => {
  it("the real pager loads every entry with none dropped", async () => {
    const flat = await fetchLedger(mockSupabase(YEAR_DATA.entries), COMPANY_ID, DEFAULT_CHART_OF_ACCOUNTS);
    const baseIds = new Set(flat.map(r => String(r.id).split("_")[0]));
    expect(baseIds.size).toBe(TOTAL_ENTRIES);           // every journal entry survived paging
    expect(baseIds.has("OPENING")).toBe(true);          // opening balance present
  });
  it("computed figures over the paged ledger match the answer key (parity with the direct flatten)", async () => {
    const flat = await fetchLedger(mockSupabase(YEAR_DATA.entries), COMPANY_ID, DEFAULT_CHART_OF_ACCOUNTS);
    expect(computeNetIncome(flat)).toBe(KEY.netIncome);
    expect(glCashOnHand(flat, [C.cash, C.savings])).toBe(KEY.endingCash);
  });
});

describe("8 · Sign-off — all three nets clear on the clean year (owner trust panel can go green)", () => {
  it("no confidence flags on the clean year", () => {
    expect(flaggedForReview(INVOICES)).toHaveLength(0);
  });
  it("evaluateSignOff → ok (completeness + confidence + accuracy all clear)", () => {
    const res = evaluateSignOff({
      controlTotals: CONTROL, openConfidenceFlags: flaggedForReview(INVOICES), droppedDocs: [], unknownDocs: [],
    });
    expect(res.ok).toBe(true);
    expect(res.blockers).toHaveLength(0);
  });
  it("the bank is matched (a recent completed reconciliation) → not overdue", () => {
    const bm = bankMatchStatus({ reconciliations: YEAR_DATA.reconciliations, invoices: INVOICES, now: NOW });
    expect(bm.everReconciled).toBe(true);
    expect(bm.overdue).toBe(false);
  });
  it("signOffReadiness (four nets incl. bank-match) → ok — the period is attestable", () => {
    const bm = bankMatchStatus({ reconciliations: YEAR_DATA.reconciliations, invoices: INVOICES, now: NOW });
    const res = signOffReadiness({
      controlTotals: CONTROL, openConfidenceFlags: flaggedForReview(INVOICES), droppedDocs: [], unknownDocs: [], bankMatch: bm,
    });
    expect(res.ok).toBe(true);
  });
});

describe("Edge case — depreciation on a Jan-31 in-service date (CR-4: Feb not skipped, no overflow)", () => {
  const { schedule } = YEAR_DATA;
  it("period 1 clamps Jan 31 +1mo to Feb 28 (never overflows to Mar)", () => {
    expect(schedule.entries[0].date).toBe("2026-01-31");
    expect(schedule.entries[1].date).toBe("2026-02-28");
    expect(schedule.entries[2].date).toBe("2026-03-31");
  });
  it("every month Jan–Dec 2026 has exactly one depreciation period (Feb is present)", () => {
    const months = schedule.entries.filter(e => String(e.date) <= YEAR_END).map(e => String(e.date).slice(0, 7));
    expect(months).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]);
  });
  it(`the year's depreciation expense === $${(MONTHLY_DEP * DEP_MONTHS_2026).toLocaleString()} and net book value ties`, () => {
    expect(glAccountBalance(C.depExp, INVOICES)).toBe(r2(MONTHLY_DEP * DEP_MONTHS_2026));      // +2,400 expense
    expect(glAccountBalance(C.accumDep, INVOICES)).toBe(r2(-MONTHLY_DEP * DEP_MONTHS_2026));   // −2,400 contra-asset
    // Net book value = cost − accumulated = 12,000 − 2,400 = 9,600.
    expect(r2(glAccountBalance(C.fixedAssets, INVOICES) + glAccountBalance(C.accumDep, INVOICES))).toBe(9600);
  });
});

describe("Edge case — period boundaries (the TZ class: entries land in the correct month)", () => {
  it("the 12 monthly revenue slices sum to the annual total (no boundary leak)", () => {
    let sum = 0;
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, "0");
      sum = r2(sum + computeRevenue(INVOICES, { from: `${YEAR}-${mm}-01`, to: `${YEAR}-${mm}-31` }));
    }
    expect(sum).toBe(KEY.totalRevenue);
  });
  it("a last-day-of-month sale counts in that month, not the next", () => {
    const dec = computeRevenue(INVOICES, { from: "2026-12-01", to: "2026-12-31" });
    const janNext = computeRevenue(INVOICES, { from: "2027-01-01", to: "2027-01-31" });
    expect(dec).toBeGreaterThan(0);      // Dec-31 sales landed in December
    expect(janNext).toBe(0);             // nothing spilled into next year
  });
});

// ── Human-readable report (printed once) ──────────────────────────────────────
describe("report", () => {
  it("prints the year shape + answer key + tie-out", () => {
    const lines = [
      "",
      "══════════ O59 FULL-YEAR SIMULATION ══════════",
      `Journal entries: ${TOTAL_ENTRIES}  (1080 cash sales, 12 rent, 5 AR invoices, 3 collections,`,
      `                 accrual bill+payment+open bill, void+reversal, refund, asset buy, 12 depreciation, opening)`,
      "Edge cases: void/reversal (CR-1) · refund/Dr-Revenue (CR-2) · sales tax (Riverside) ·",
      "            AP/AR accrual across month boundary · Jan-31 depreciation (CR-4) ·",
      "            1120 entries via the real pager (CR-14) · month/year-boundary dates · bank reconciliation",
      "── Answer key (hand-computed) vs REAL compute ──",
      `Revenue          $${KEY.totalRevenue.toLocaleString()}   → ${computeRevenue(INVOICES).toLocaleString()}`,
      `Expenses         $${KEY.totalExpenses.toLocaleString()}    → ${computeExpenses(INVOICES).toLocaleString()}`,
      `Net income       $${KEY.netIncome.toLocaleString()}    → ${computeNetIncome(INVOICES).toLocaleString()}`,
      `Ending cash      $${KEY.endingCash.toLocaleString()}   → ${glCashOnHand(INVOICES, [C.cash, C.savings]).toLocaleString()}`,
      `A/R              $${KEY.arBalance.toLocaleString()}     → ${computeAR(INVOICES, { now: NOW }).total.toLocaleString()}`,
      `A/P              $${KEY.apBalance.toLocaleString()}     → ${computeAP(INVOICES, { now: NOW }).total.toLocaleString()}`,
      `Sales tax owed   $${KEY.salesTaxPayable.toLocaleString()}      → ${glAccountBalance(C.salesTax, INVOICES).toLocaleString()}`,
      `Assets           $${KEY.totalAssets.toLocaleString()}   → ${GL_ASSETS.toLocaleString()}   (= Liab ${GL_LIAB.toLocaleString()} + Equity ${GL_EQUITY.toLocaleString()} + NI ${GL_NET.toLocaleString()})`,
      `Control totals: ${CONTROL.checks.length}/6 checked, allTie=${CONTROL.allTie}`,
      "═══════════════════════════════════════════════",
    ];
    // eslint-disable-next-line no-console
    console.log(lines.join("\n"));
    expect(true).toBe(true);
  });
});
