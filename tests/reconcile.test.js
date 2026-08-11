import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { touchesCashAccount, cashLegSigned, reconBooksSet, statementBalanceVerified, canCompleteReconciliation,
  isOpeningPositionRow, reconBooksBalance, reconOutstandingBooks, reconMarkedOutstanding, reconcileDifference, reconciliationActivityLine } from "../src/lib/reconcile.js";
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
  it("an outstanding check nets ONLY once MARKED 'hasn't hit the bank yet' (O83 Feb fix)", () => {
    // A $200 uncashed check (Cr Cash) written Jan 31: GL cash drops 200; bank hasn't seen it.
    const withCheck = [...JAN, { id: "chk", date: "2026-01-31", gl_code: "6100", secondary_gl_code: AC1, debit_credit: "debit", amount: 200, status: "booked", type: "expense" }];
    const booksBalance = reconBooksBalance(withCheck, [AC1], { asOf: "2026-01-31" });   // 15657.60 − 200 = 15457.60
    expect(booksBalance).toBe(15457.60);
    const books = reconBooksSet(withCheck, { cashCodes: [AC1], from: "2026-01-01", to: "2026-01-31" }).filter(b => !isOpeningPositionRow(b, "2026-01-01"));
    const matched = new Set(["d1", "p1"]);                        // the check did NOT clear

    // UNDECIDED (not yet marked): it sits in the sort-out queue and does NOT net — the gap stands,
    // so Complete stays disabled until the user decides.
    const queue = reconOutstandingBooks(books, { matchedBookIds: matched, hidden: {}, periodStart: "2026-01-01" });
    expect(queue.some(b => b.id === "chk")).toBe(true);
    const undecidedSigned = reconMarkedOutstanding(books, { matchedBookIds: matched, marked: {}, periodStart: "2026-01-01" }).reduce((s, b) => s + cashLegSigned(b, [AC1]), 0);
    expect(reconcileDifference({ statementBalance: 15657.60, booksBalance, outstandingSigned: undecidedSigned, unmatchedBankSigned: 0 })).toBe(200);   // gap = the uncashed check

    // MARKED outstanding: leaves the sort-out queue, enters the outstanding set, nets to 0.
    const marked = { chk: true };
    expect(reconOutstandingBooks(books, { matchedBookIds: matched, hidden: marked, periodStart: "2026-01-01" }).some(b => b.id === "chk")).toBe(false);
    const outBooks = reconMarkedOutstanding(books, { matchedBookIds: matched, marked, periodStart: "2026-01-01" });
    expect(outBooks.map(b => b.id)).toEqual(["chk"]);
    const outSigned = outBooks.reduce((s, b) => s + cashLegSigned(b, [AC1]), 0);   // −200
    expect(outSigned).toBe(-200);
    expect(reconcileDifference({ statementBalance: 15657.60, booksBalance, outstandingSigned: outSigned, unmatchedBankSigned: 0 })).toBe(0);
  });
});

describe("O83 Feb — 'Hasn't hit the bank yet' nets the difference (the exact live scenario)", () => {
  // 21 matched bank lines + one $275 Atlas check (Feb 26) marked outstanding; bank 20,614.40,
  // books 20,339.40. Expected: 20,614.40 + (−275.00) − 20,339.40 = 0.00 → Complete enabled.
  const CASH = "1000";
  const atlas = { id: "atlas", date: "2026-02-26", gl_code: "6100", secondary_gl_code: CASH, debit_credit: "debit", amount: 275, status: "booked", type: "expense" };
  const matchedBooks = Array.from({ length: 21 }, (_, i) => ({ id: `m${i}`, date: "2026-02-10", gl_code: "6000", secondary_gl_code: CASH, debit_credit: "debit", amount: 100, status: "booked" }));
  const booksRows = [...matchedBooks, atlas];
  const matchedBookIds = new Set(matchedBooks.map(b => b.id));

  const diffFor = (marked) => {
    const outBooks = reconMarkedOutstanding(booksRows, { matchedBookIds, marked, periodStart: "2026-02-01" });
    const outstandingSigned = outBooks.reduce((s, b) => s + cashLegSigned(b, [CASH]), 0);
    return reconcileDifference({ statementBalance: 20614.40, booksBalance: 20339.40, outstandingSigned, unmatchedBankSigned: 0 });
  };

  it("marked outstanding → difference nets to 0.00, Complete enabled", () => {
    const diff = diffFor({ atlas: true });
    expect(diff).toBe(0);
    expect(canCompleteReconciliation({ statementBalance: "20614.40", difference: diff })).toBe(true);
  });
  it("un-marking restores the $275.00 gap (Complete disabled again)", () => {
    const diff = diffFor({});
    expect(diff).toBe(275);
    expect(canCompleteReconciliation({ statementBalance: "20614.40", difference: diff })).toBe(false);
  });
  it("the marked item is EXCLUDED from the books 'matched' count and INCLUDED in the outstanding set", () => {
    const marked = { atlas: true };
    const matchedBooksCount = booksRows.filter(b => matchedBookIds.has(b.id)).length;
    const outBooks = reconMarkedOutstanding(booksRows, { matchedBookIds, marked, periodStart: "2026-02-01" });
    expect(matchedBooksCount).toBe(21);              // NOT 22 — the check isn't "matched"
    expect(outBooks.map(b => b.id)).toEqual(["atlas"]);
    // sort-out queue is empty (everything is matched or marked-outstanding) → clean rec
    expect(reconOutstandingBooks(booksRows, { matchedBookIds, hidden: marked, periodStart: "2026-02-01" })).toEqual([]);
  });
  it("save/resume round-trip: persisted outstanding_books rebuilds the marking and still nets to 0", () => {
    // serialize() stores the marked rows; resume() rebuilds the `marked` map from them.
    const persisted = reconMarkedOutstanding(booksRows, { matchedBookIds, marked: { atlas: true }, periodStart: "2026-02-01" })
      .map(b => ({ id: b.id, date: b.date, amount: b.amount, gl_code: b.gl_code }));
    const rebuilt = {};
    for (const o of persisted) { const id = (o && typeof o === "object") ? o.id : o; if (id != null) rebuilt[id] = true; }
    expect(rebuilt).toEqual({ atlas: true });
    expect(diffFor(rebuilt)).toBe(0);               // marking survived the round-trip
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

import { supersedableOpenReconciliations } from "../src/lib/reconcile.js";

describe("supersedableOpenReconciliations — completing supersedes stale open rows (O83 Bug 2)", () => {
  const feb = { periodStart: "2026-02-01", periodEnd: "2026-02-28" };
  const orphan   = { id: "orphan",   status: "open",     account_id: "acc1", account_name: "Primary Checking", period_start: "2026-02-01", period_end: "2026-02-28" };
  const complete = { id: "complete", status: "complete", account_id: "acc1", account_name: "Primary Checking", period_start: "2026-02-01", period_end: "2026-02-28" };
  const otherPer = { id: "jan",      status: "open",     account_id: "acc1", account_name: "Primary Checking", period_start: "2026-01-01", period_end: "2026-01-31" };
  const otherAcc = { id: "savings",  status: "open",     account_id: "acc2", account_name: "Savings",          period_start: "2026-02-01", period_end: "2026-02-28" };

  it("picks the stale open row for the same account+period, excluding the completed one", () => {
    const stale = supersedableOpenReconciliations([orphan, complete, otherPer, otherAcc], { accountId: "acc1", accountName: "Primary Checking", ...feb, keepId: "complete" });
    expect(stale.map(r => r.id)).toEqual(["orphan"]);   // only the orphan; not other period/account, not completed
  });
  it("never supersedes the row being completed (keepId)", () => {
    const stale = supersedableOpenReconciliations([{ ...orphan, id: "self", status: "open" }], { accountId: "acc1", accountName: "Primary Checking", ...feb, keepId: "self" });
    expect(stale).toEqual([]);
  });
  it("matches by account_name when there's no account_id (manual account)", () => {
    const manualOrphan = { id: "m", status: "open", account_id: null, account_name: "Manual", period_start: "2026-02-01", period_end: "2026-02-28" };
    const stale = supersedableOpenReconciliations([manualOrphan], { accountId: "manual", accountName: "Manual", ...feb, keepId: "new" });
    expect(stale.map(r => r.id)).toEqual(["m"]);
  });
  it("complete-with-a-stale-open-row-present → exactly one Complete, zero open (the scenario)", () => {
    // After completing, the app deletes the stale set; simulate the resulting state.
    const all = [orphan, complete];
    const toDelete = new Set(supersedableOpenReconciliations(all, { accountId: "acc1", accountName: "Primary Checking", ...feb, keepId: "complete" }).map(r => r.id));
    const remaining = all.filter(r => !toDelete.has(r.id));
    expect(remaining.map(r => r.id)).toEqual(["complete"]);
    expect(remaining.filter(r => r.status === "open")).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// C198·3c (iii) — "TRANSACTIONS MATCHED: 0" ON A MONTH THAT WENT PERFECTLY.
//
// O87 July: 21 lines, 17 auto-booked, difference 0, auto-completed and signed off —
// and the completed record's detail card said "Transactions matched: 0". Literally
// true (the auto path BOOKS, it does not MATCH, so the matcher's counter is zero) and
// it reads as failure. The count is not wrong; the LABEL is. Same true-but-reads-false
// class as the C198·2b queue line and the ·3b re-upload toast.
// ════════════════════════════════════════════════════════════════════════════
describe("(iii) the completed-reconciliation detail says what happened", () => {
  const AUTO = { matched_transactions: [], unmatched_bank: [], status: "complete", difference: 0 };
  const SESSION = { matched_transactions: [{ bank: { id: "t1" }, bookId: "b1" }, { bank: { id: "t2" }, bookId: "b2" }], status: "complete" };

  it("★ an auto-path month NEVER renders 'Transactions matched: 0'", () => {
    const line = reconciliationActivityLine(AUTO, { booksCount: 21 });
    expect(line.label).not.toBe("Transactions matched");
    expect(String(line.value)).not.toBe("0");
    expect(line.value).toBe("21 transactions already in your books");
  });

  it("a SESSION-matched month keeps its real count under its real label", () => {
    expect(reconciliationActivityLine(SESSION, { booksCount: 21 })).toEqual({ label: "Transactions matched", value: "2" });
  });

  it("a session count is never overwritten by the books count — they can differ", () => {
    expect(reconciliationActivityLine(SESSION, { booksCount: 0 }).value).toBe("2");
    expect(reconciliationActivityLine(SESSION, { booksCount: null }).value).toBe("2");
  });

  it("one transaction is singular", () => {
    expect(reconciliationActivityLine(AUTO, { booksCount: 1 }).value).toBe("1 transaction already in your books");
  });

  it("zero rows is reported as a QUERY result, never as a fact about the month", () => {
    // The O87 Q2 lesson: an empty result set may only ever be reported as an empty
    // result set. "There were no transactions" would be a claim about the world.
    const v = reconciliationActivityLine(AUTO, { booksCount: 0 }).value;
    expect(v).toBe("We didn't find any in your books for this period");
    expect(v).not.toMatch(/there (were|are) no|nothing happened|no transactions in/i);
  });

  it("no countable books → an em dash, never a number we can't stand behind", () => {
    for (const c of [null, undefined, NaN, -3, "twenty-one"]) {
      expect(reconciliationActivityLine(AUTO, { booksCount: c }).value).toBe("—");
    }
    expect(reconciliationActivityLine(AUTO).value).toBe("—");
  });

  it("a malformed record degrades instead of throwing", () => {
    expect(reconciliationActivityLine().value).toBe("—");
    expect(reconciliationActivityLine({ matched_transactions: null }, { booksCount: 4 }).value).toBe("4 transactions already in your books");
  });

  it("END TO END — July's shape, counted off the real books set", () => {
    // reconBooksSet is what the view feeds in: live cash-touching rows in the period,
    // less the opening position. The 21 is COUNTED, never invented.
    const july = [
      { id: "ob", source: "opening_balance", date: "2026-07-01", gl_code: AC1, secondary_gl_code: "3400", debit_credit: "debit", amount: 1000, status: "booked" },
      ...Array.from({ length: 21 }, (_, i) => ({
        id: `t${i}`, date: `2026-07-${String((i % 27) + 1).padStart(2, "0")}`,
        gl_code: "6000", secondary_gl_code: AC1, debit_credit: "debit", amount: 100 + i, status: "booked",
      })),
      { id: "aug", date: "2026-08-02", gl_code: "6000", secondary_gl_code: AC1, debit_credit: "debit", amount: 50, status: "booked" },   // out of period
    ];
    const booksCount = reconBooksSet(july, { cashCodes: [AC1], from: "2026-07-01", to: "2026-07-31" })
      .filter(r => !isOpeningPositionRow(r, "2026-07-01")).length;
    expect(booksCount).toBe(21);
    expect(reconciliationActivityLine(AUTO, { booksCount }).value).toBe("21 transactions already in your books");
  });
});

// The count the card renders is computed in ReconView, not here, so the recipe passing
// says nothing about the caller. This pins the two properties that make the number
// honest: it is scoped to THIS record's own bank account, and an unresolvable account
// yields null (an em dash) rather than a figure summed across every cash account —
// which on a multi-bank company would also double-count a cash-to-cash transfer.
describe("(iii) ReconView computes that count against the record's OWN account", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/components/views/ReconView.jsx"), "utf8");
  const block = src.slice(src.indexOf("const viewingBooksCount"), src.indexOf("const viewingActivity"));

  it("resolves the bank account from viewing.account_id and uses only its gl_code", () => {
    expect(block).toMatch(/String\(viewing\.account_id\)/);
    expect(block).toMatch(/cashCodes:\s*\[String\(acct\.gl_code\)\]/);
  });

  it("returns null when the account can't be resolved — no all-cash-codes fallback", () => {
    expect(block).toMatch(/if\s*\(!acct\?\.gl_code\)\s*return null/);
    expect(block).not.toMatch(/cashGlCodes/);
  });

  it("excludes the opening position and scopes to the record's period", () => {
    expect(block).toMatch(/isOpeningPositionRow\(b, viewing\.period_start\)/);
    expect(block).toMatch(/from: viewing\.period_start, to: viewing\.period_end/);
  });

  it("the card renders the helper's label AND value, not a hardcoded 'Transactions matched'", () => {
    const card = src.slice(src.indexOf("✓ COMPLETE"), src.indexOf("✓ COMPLETE") + 1400);
    expect(card).toMatch(/\[viewingActivity\.label,\s*viewingActivity\.value\]/);
    expect(card).not.toMatch(/"Transactions matched",\(viewing\.matched_transactions/);
  });
});
