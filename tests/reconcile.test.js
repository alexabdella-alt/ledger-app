import { describe, it, expect } from "vitest";
import { touchesCashAccount, cashLegSigned, reconBooksSet, statementBalanceVerified, canCompleteReconciliation,
  isOpeningPositionRow, reconBooksBalance, reconOutstandingBooks, reconcileDifference } from "../src/lib/reconcile.js";
import { openingDiscrepancy } from "../src/lib/openingBalanceProposal.js";

// ════════════════════════════════════════════════════════════════════════════
// O83 — Reconcile completion bar: "What your books show" = GL cash (not derived from
// the bank input); opening-balance entry auto-resolved (never a sort-out prompt).
// Franklin January: opening $12,483.27 (2026-01-01) + net $3,174.33 = GL cash $15,657.60.
// ════════════════════════════════════════════════════════════════════════════
const AC1 = "1000";
// Flattened rows exactly as flattenJournalEntries emits them.
const JAN = [
  { id: "ob", source: "opening_balance", date: "2026-01-01", gl_code: AC1, secondary_gl_code: "3400", debit_credit: "debit", amount: 12483.27, status: "booked" },      // Dr Cash / Cr OBE
  { id: "d1", date: "2026-01-10", gl_code: "4000", secondary_gl_code: AC1, debit_credit: "credit", amount: 5000.00, status: "booked", type: "revenue" },                 // Dr Cash / Cr Revenue (+)
  { id: "p1", date: "2026-01-15", gl_code: "6100", secondary_gl_code: AC1, debit_credit: "debit", amount: 1825.67, status: "booked", type: "expense" },                  // Dr Expense / Cr Cash (−)
];

describe("BUG 1 — 'What your books show' = GL cash, independent of the bank input", () => {
  it("books balance = GL cash for the account at period end ($15,657.60, incl. opening)", () => {
    expect(reconBooksBalance(JAN, [AC1], { asOf: "2026-01-31" })).toBe(15657.60);
  });
  it("is INDEPENDENT of the bank-ending input (the mutation bug — it takes no statementBalance)", () => {
    const b = reconBooksBalance(JAN, [AC1], { asOf: "2026-01-31" });
    // Typing any bank balance changes only stmtNum → the difference, never the books figure.
    expect(reconcileDifference({ statementBalance: 0, booksBalance: b, outstandingSigned: 0, unmatchedBankSigned: 0 })).toBe(-15657.60);
    expect(reconcileDifference({ statementBalance: 99999, booksBalance: b, outstandingSigned: 0, unmatchedBankSigned: 0 })).toBe(84341.40);
    expect(reconBooksBalance(JAN, [AC1], { asOf: "2026-01-31" })).toBe(15657.60);   // unchanged
  });
});

describe("BUG 2 — the opening-balance entry is the starting position, never a sort-out item", () => {
  it("isOpeningPositionRow flags an opening entry dated at/before period start", () => {
    expect(isOpeningPositionRow(JAN[0], "2026-01-01")).toBe(true);
    expect(isOpeningPositionRow(JAN[1], "2026-01-01")).toBe(false);   // a normal txn
  });
  it("the opening entry NEVER appears in the sort-out queue", () => {
    const books = reconBooksSet(JAN, { cashCodes: [AC1], from: "2026-01-01", to: "2026-01-31" });
    const out = reconOutstandingBooks(books, { matchedBookIds: new Set(), hidden: {}, periodStart: "2026-01-01" });
    expect(out.some(r => r.id === "ob")).toBe(false);   // opening excluded
    // and the transactions are outstanding only until matched
    expect(out.map(r => r.id).sort()).toEqual(["d1", "p1"]);
  });
});

describe("January scenario end-to-end — 20/20 matched, bank 15657.60 → difference $0.00", () => {
  it("difference nets to zero and Complete Match is enabled", () => {
    const books = reconBooksSet(JAN, { cashCodes: [AC1], from: "2026-01-01", to: "2026-01-31" })
      .filter(b => !isOpeningPositionRow(b, "2026-01-01"));
    const matched = new Set(["d1", "p1"]);                         // both txns matched to bank lines
    const outstanding = reconOutstandingBooks(books, { matchedBookIds: matched, hidden: {}, periodStart: "2026-01-01" });
    expect(outstanding).toEqual([]);                              // nothing left to sort out
    const booksBalance = reconBooksBalance(JAN, [AC1], { asOf: "2026-01-31" });
    const diff = reconcileDifference({ statementBalance: 15657.60, booksBalance, outstandingSigned: 0, unmatchedBankSigned: 0 });
    expect(diff).toBe(0);
    expect(canCompleteReconciliation({ statementBalance: "15657.60", difference: diff })).toBe(true);
  });
  it("a genuinely-outstanding check keeps the rec balanced via the formula", () => {
    // A $200 uncashed check (Cr Cash) written Jan 31: GL cash drops 200; bank hasn't seen it.
    const withCheck = [...JAN, { id: "chk", date: "2026-01-31", gl_code: "6100", secondary_gl_code: AC1, debit_credit: "debit", amount: 200, status: "booked", type: "expense" }];
    const booksBalance = reconBooksBalance(withCheck, [AC1], { asOf: "2026-01-31" });   // 15657.60 − 200 = 15457.60
    expect(booksBalance).toBe(15457.60);
    const books = reconBooksSet(withCheck, { cashCodes: [AC1], from: "2026-01-01", to: "2026-01-31" }).filter(b => !isOpeningPositionRow(b, "2026-01-01"));
    const matched = new Set(["d1", "p1"]);                        // the check did NOT clear
    const outstanding = reconOutstandingBooks(books, { matchedBookIds: matched, hidden: {}, periodStart: "2026-01-01" });
    const outSigned = outstanding.reduce((s, b) => s + cashLegSigned(b, [AC1]), 0);   // −200
    expect(outSigned).toBe(-200);
    // bank still shows 15657.60 (check uncashed); difference nets to 0.
    expect(reconcileDifference({ statementBalance: 15657.60, booksBalance, outstandingSigned: outSigned, unmatchedBankSigned: 0 })).toBe(0);
  });
});

describe("Statement opening vs books opening mismatch → discrepancy flag (not a sort-out prompt)", () => {
  it("raises a discrepancy and the difference is honestly non-zero", () => {
    const booksOpening = cashLegSigned(JAN[0], [AC1]);           // +12483.27 (books' opening)
    const d = openingDiscrepancy({ statedOpening: 12000, recordedOpening: booksOpening });
    expect(d.mismatch).toBe(true);
    expect(d.diff).toBe(-483.27);
    // the opening is STILL auto-resolved (never in sort-out) regardless of the mismatch
    const books = reconBooksSet(JAN, { cashCodes: [AC1], from: "2026-01-01", to: "2026-01-31" });
    expect(reconOutstandingBooks(books, { matchedBookIds: new Set(["d1","p1"]), hidden: {}, periodStart: "2026-01-01" }).some(r => r.id === "ob")).toBe(false);
    // and if the bank ending reflects the REAL 12000 opening (12000+3174.33=15174.33), the books
    // (wrong opening 12483.27 → 15657.60) don't reconcile — difference is honest, not hidden.
    const booksBalance = reconBooksBalance(JAN, [AC1], { asOf: "2026-01-31" });
    expect(reconcileDifference({ statementBalance: 15174.33, booksBalance, outstandingSigned: 0, unmatchedBankSigned: 0 })).toBe(-483.27);
  });
});


// ── O83 follow-up 2: completion guard (block unverified $0; verified-zero path works) ──
describe("statementBalanceVerified — a real or explicitly-confirmed balance", () => {
  it("blank balance is NEVER verified (blocks completion at the source)", () => {
    expect(statementBalanceVerified("", false)).toBe(false);
    expect(statementBalanceVerified(null, false)).toBe(false);
    expect(statementBalanceVerified("   ", false)).toBe(false);
  });
  it("a non-zero balance is verified", () => {
    expect(statementBalanceVerified("15657.60", false)).toBe(true);
    expect(statementBalanceVerified("-42.10", false)).toBe(true);
  });
  it("$0 is verified ONLY with the explicit empty/closed confirmation", () => {
    expect(statementBalanceVerified("0", false)).toBe(false);   // the Franklin phantom shape — blocked
    expect(statementBalanceVerified("0", true)).toBe(true);     // confirmed empty/closed → verified-zero
  });
});

describe("canCompleteReconciliation — balanced AND verified", () => {
  it("blocked without a statement balance (even when balanced)", () => {
    expect(canCompleteReconciliation({ statementBalance: "", difference: 0 })).toBe(false);
  });
  it("blocked when the difference isn't zero", () => {
    expect(canCompleteReconciliation({ statementBalance: "15657.60", difference: 12.5 })).toBe(false);
  });
  it("blocked on an unconfirmed $0", () => {
    expect(canCompleteReconciliation({ statementBalance: "0", difference: 0, emptyConfirmed: false })).toBe(false);
  });
  it("verified-zero (confirmed empty/closed) + balanced → completes", () => {
    expect(canCompleteReconciliation({ statementBalance: "0", difference: 0, emptyConfirmed: true })).toBe(true);
  });
  it("real balance + balanced → completes", () => {
    expect(canCompleteReconciliation({ statementBalance: "15657.60", difference: 0 })).toBe(true);
  });
});

// Reconciliation books-set = entries that HIT the reconciled cash account, GL-derived.
// Codes: CASH 1000 (reconciled), CASH2 1010 (a second bank), AP 2000, AR 1100, OBE 3400,
// EXP 6800, REV 4100, PAYTAX 2200.
const CASH = "1000", CASH2 = "1010", AP = "2000", AR = "1100", OBE = "3400", EXP = "6800", REV = "4100", PAYTAX = "2200";
const codes = [CASH];

// Flattened shapes exactly as flattenJournalEntries emits them.
const directExpense = { id: "e1", date: "2026-05-04", amount: 500, gl_code: EXP, secondary_gl_code: CASH, debit_credit: "debit", type: "expense" };            // Dr Expense / Cr Cash
const directRevenue = { id: "e2", date: "2026-05-06", amount: 900, gl_code: REV, secondary_gl_code: CASH, debit_credit: "credit", type: "revenue" };           // Dr Cash / Cr Revenue
const accrualBill   = { id: "e3", date: "2026-05-08", amount: 700, gl_code: EXP, secondary_gl_code: AP, debit_credit: "debit", type: "expense" };              // Dr Expense / Cr A/P — NO cash
const arInvoice     = { id: "e4", date: "2026-05-09", amount: 1200, gl_code: REV, secondary_gl_code: AR, debit_credit: "credit", type: "revenue" };            // Dr A/R / Cr Revenue — NO cash
const apPayment     = { id: "e5", date: "2026-05-20", amount: 700, gl_code: AP, secondary_gl_code: CASH, debit_credit: "debit", type: "expense", import_metadata: { kind: "ap_payment", payment_for: "e3" } }; // Dr A/P / Cr Cash
const arCollection  = { id: "e6", date: "2026-05-22", amount: 1200, gl_code: CASH, secondary_gl_code: AR, debit_credit: "debit", type: "expense", import_metadata: { kind: "ar_collection", payment_for: "e4" } }; // Dr Cash / Cr A/R
const partialPay    = { id: "e7", date: "2026-05-25", amount: 300, gl_code: AP, secondary_gl_code: CASH, debit_credit: "debit", type: "expense", import_metadata: { kind: "ap_payment" } }; // partial: cash amount 300, not the bill's 700
// Transfer Dr CASH2 / Cr CASH — primary is first debit (CASH2).
const transfer      = { id: "e8", date: "2026-05-28", amount: 1000, gl_code: CASH2, secondary_gl_code: CASH, debit_credit: "debit", type: "expense" };
// Multi-line payroll: Dr Salaries / Dr Payroll Tax / Cr Cash(net) / Cr Payroll Payable
const prSalary  = { id: "e9_0", date: "2026-05-31", amount: 4000, gl_code: EXP, secondary_gl_code: CASH, debit_credit: "debit", type: "expense" };   // secondary is the entry's first credit (Cash) — but this leg is NOT cash
const prTax     = { id: "e9_1", date: "2026-05-31", amount: 300, gl_code: EXP, secondary_gl_code: CASH, debit_credit: "debit", type: "expense" };
const prCash    = { id: "e9_2", date: "2026-05-31", amount: 3800, gl_code: CASH, secondary_gl_code: EXP, debit_credit: "credit", type: "expense" };  // the real cash leg (net pay out)
const prPayable = { id: "e9_3", date: "2026-05-31", amount: 500, gl_code: PAYTAX, secondary_gl_code: EXP, debit_credit: "credit", type: "expense" };
// A reversal of a cash payment (Dr Cash / Cr Expense) — opposite of directExpense.
const reversalOfExpense = { id: "e10", date: "2026-05-15", amount: 500, gl_code: EXP, secondary_gl_code: CASH, debit_credit: "credit", type: "expense", import_metadata: { reverses: "e1" } };

describe("touchesCashAccount — cash participation, GL-derived", () => {
  it("includes entries with a cash leg (primary OR offset)", () => {
    expect(touchesCashAccount(directExpense, codes)).toBe(true);   // cash offset
    expect(touchesCashAccount(directRevenue, codes)).toBe(true);   // cash offset
    expect(touchesCashAccount(apPayment, codes)).toBe(true);       // cash offset
    expect(touchesCashAccount(arCollection, codes)).toBe(true);    // cash primary
    expect(touchesCashAccount(transfer, codes)).toBe(true);        // cash offset (CASH is Cr leg)
  });
  it("EXCLUDES accrual bills and uncollected AR invoices (no cash leg)", () => {
    expect(touchesCashAccount(accrualBill, codes)).toBe(false);
    expect(touchesCashAccount(arInvoice, codes)).toBe(false);
  });
  it("multi-line: ONLY the actual cash leg, not sibling legs whose offset happens to be cash", () => {
    expect(touchesCashAccount(prSalary, codes)).toBe(false);   // gl=Expense, id has _ → not the cash leg
    expect(touchesCashAccount(prTax, codes)).toBe(false);
    expect(touchesCashAccount(prCash, codes)).toBe(true);      // gl=Cash → the cash leg
    expect(touchesCashAccount(prPayable, codes)).toBe(false);
  });
});

describe("cashLegSigned — + when cash is debited (in), − when credited (out)", () => {
  it("direct cash expense is money OUT, revenue is money IN", () => {
    expect(cashLegSigned(directExpense, codes)).toBe(-500);
    expect(cashLegSigned(directRevenue, codes)).toBe(900);
  });
  it("settlements: A/P payment OUT, A/R collection IN", () => {
    expect(cashLegSigned(apPayment, codes)).toBe(-700);
    expect(cashLegSigned(arCollection, codes)).toBe(1200);
  });
  it("partial payment signs the CASH amount, not the bill amount", () => {
    expect(cashLegSigned(partialPay, codes)).toBe(-300);
  });
  it("multi-line net-pay cash leg is money OUT at the cash amount", () => {
    expect(cashLegSigned(prCash, codes)).toBe(-3800);
  });
  it("transfer signs opposite in each account (out of source, into destination)", () => {
    expect(cashLegSigned(transfer, [CASH])).toBe(-1000);   // CASH is credited → out of the source account
    expect(cashLegSigned(transfer, [CASH2])).toBe(1000);   // CASH2 is debited → into the destination account
  });
});

describe("reconBooksSet — the accrual lifecycle", () => {
  const all = [directExpense, directRevenue, accrualBill, arInvoice, apPayment, arCollection, partialPay, transfer, prSalary, prTax, prCash, prPayable, reversalOfExpense];
  const set = reconBooksSet(all, { cashCodes: codes, from: "2026-05-01", to: "2026-05-31" });
  const ids = set.map(r => r.id);

  it("accrual bill is ABSENT; its payment is PRESENT at the paid amount", () => {
    expect(ids).not.toContain("e3");                 // the bill (Dr Expense / Cr A/P) — no cash
    expect(ids).toContain("e5");                      // its payment (Dr A/P / Cr Cash)
    expect(cashLegSigned(apPayment, codes)).toBe(-700);
  });
  it("uncollected AR invoice is ABSENT; its collection is PRESENT", () => {
    expect(ids).not.toContain("e4");
    expect(ids).toContain("e6");
  });
  it("no double-count: only ONE book item per bank cash movement (bill+payment ≠ two book rows)", () => {
    // Bill 700 out + its 700 payment would have been -1400 under the old P&L set; now only -700.
    const apLifecycle = set.filter(r => r.id === "e3" || r.id === "e5");
    expect(apLifecycle.map(r => r.id)).toEqual(["e5"]);   // just the cash payment
  });
  it("multi-line entry contributes exactly one row (the cash leg)", () => {
    expect(ids.filter(id => String(id).startsWith("e9_"))).toEqual(["e9_2"]);
  });
  it("a live reversal of a cash payment nets out against the original (both present, sum 0)", () => {
    expect(ids).toContain("e1");
    expect(ids).toContain("e10");
    expect(cashLegSigned(directExpense, codes) + cashLegSigned(reversalOfExpense, codes)).toBe(0);
  });
  it("excludes out-of-period and voided entries", () => {
    const withEdge = [...all,
      { id: "old", date: "2026-04-30", amount: 100, gl_code: EXP, secondary_gl_code: CASH, debit_credit: "debit" },
      { id: "void", date: "2026-05-10", amount: 100, gl_code: EXP, secondary_gl_code: CASH, debit_credit: "debit", status: "voided" },
    ];
    const s2 = reconBooksSet(withEdge, { cashCodes: codes, from: "2026-05-01", to: "2026-05-31" }).map(r => r.id);
    expect(s2).not.toContain("old");
    expect(s2).not.toContain("void");
  });
});
