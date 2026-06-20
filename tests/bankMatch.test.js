import { describe, it, expect } from "vitest";
import { planBankImport, isArMatch } from "../src/lib/bankMatch.js";
import { glAccountBalance } from "../src/lib/reports.js";

// GL codes (defaults).
const EXP = "6400", AP = "2000", ACCRUED = "2100", AR = "1100", CASH = "1000", REV = "4000";
const codes = { apCode: AP, accruedCode: ACCRUED, arCode: AR, cashCode: CASH, cashName: "Cash" };

// Turn a planned clearing entry into the flattened-ledger row glAccountBalance reads.
// NB: id must NOT contain "_" (that marks a multi-line expansion → offset leg skipped).
const clearRow = (c, i) => ({
  id: `clr${i}`, date: c.date, amount: c.entry.amount, debit_credit: c.entry.debit_credit,
  gl_code: c.entry.gl_code, secondary_gl_code: c.entry.secondary_gl_code, status: "booked",
});

// ─────────────────────────────────────────────────────────────────────────────
// This is the integration-level guardrail the missing test would have provided:
// it drives the SAME match→book wiring handleBankFile uses (planBankImport), proving
// a matched bank line posts exactly one balanced clearing entry and is NEVER also
// booked as a standalone entry (the double-booking bug).
// ─────────────────────────────────────────────────────────────────────────────

describe("isArMatch — AP match types must NOT be treated as AR", () => {
  it("classifies each match type to the correct side", () => {
    expect(isArMatch("ap_clear")).toBe(false);    // the bug: .includes("ar") was true
    expect(isArMatch("partial_ap")).toBe(false);
    expect(isArMatch("ar_clear")).toBe(true);
    expect(isArMatch("partial_ar")).toBe(true);
  });
});

describe("bank import — withdrawal matches an open A/P bill", () => {
  // Open A/P bill, flattened: Dr Expense / Cr A/P for 151.55 (vendor Nike, unpaid).
  const bill = {
    id: "bill1", vendor: "Nike", date: "2026-05-01", amount: 151.55, type: "expense",
    debit_credit: "debit", gl_code: EXP, secondary_gl_code: AP, status: "booked",
    payment_status: "unpaid", matched: false,
  };
  const ledger = [bill];

  // One parsed bank withdrawal, with a STABLE truthy id (never id:0).
  const parsedTxns = [{
    id: "bank_1_0", vendor: "Nike", description: "ACH PAYMENT TO Nike",
    date: "2026-06-10", amount: 151.55, type: "expense", gl_code: EXP, gl_name: "Travel",
  }];
  // What the matching engine returns for it (echoes our stable bank id).
  const autoCleared = [{
    bank_txn: { id: "bank_1_0", date: "2026-06-10", vendor: "Nike", amount: -151.55 },
    invoice_ids: ["bill1"], match_type: "ap_clear", auto_clear: true, confidence: 98,
  }];

  const plan = planBankImport({ parsedTxns, autoCleared, queue: [], openItems: ledger, codes });

  it("clears the bill — exactly one match, NOTHING booked standalone", () => {
    expect(plan.clears).toHaveLength(1);
    expect(plan.clears[0]).toMatchObject({ invoiceId: "bill1", side: "ap", bankId: "bank_1_0" });
    expect(plan.standalone).toHaveLength(0);   // ← the matched line is NOT double-booked
    expect(plan.skipped).toHaveLength(0);
    expect(plan.review).toHaveLength(0);
  });

  it("the clearing entry is a single balanced Dr A/P / Cr Cash for the amount", () => {
    const e = plan.clears[0].entry;
    expect(e.gl_code).toBe(AP);            // Dr A/P
    expect(e.secondary_gl_code).toBe(CASH); // Cr Cash
    expect(e.debit_credit).toBe("debit");
    expect(e.amount).toBe(151.55);
  });

  it("relieves A/P by exactly the amount, credits Cash by exactly the amount", () => {
    expect(glAccountBalance(AP, ledger)).toBe(151.55);   // before
    expect(glAccountBalance(CASH, ledger)).toBe(0);
    const after = [...ledger, ...plan.clears.map(clearRow)];
    expect(glAccountBalance(AP, after)).toBe(0);          // A/P fully relieved
    expect(glAccountBalance(CASH, after)).toBe(-151.55);  // Cash down by the amount
  });

  it("leaves net income UNCHANGED (no duplicate expense)", () => {
    const expBefore = glAccountBalance(EXP, ledger);
    const after = [...ledger, ...plan.clears.map(clearRow)];
    expect(glAccountBalance(EXP, after)).toBe(expBefore);  // expense counted once, not twice
  });
});

describe("bank import — deposit matches an open A/R invoice", () => {
  // Open A/R invoice, flattened: Dr A/R / Cr Revenue for 2000 (uncollected). The
  // collectable shape carries A/R as the secondary offset.
  const invoice = {
    id: "inv1", vendor: "Acme Corp", date: "2026-05-01", amount: 2000, type: "revenue",
    debit_credit: "credit", gl_code: REV, secondary_gl_code: AR, status: "booked",
    payment_status: "uncollected", matched: false,
  };
  const ledger = [invoice];

  const parsedTxns = [{
    id: "bank_2_0", vendor: "Acme Corp", description: "ACH DEPOSIT ACME",
    date: "2026-06-12", amount: 2000, type: "revenue", gl_code: REV, gl_name: "Revenue",
  }];
  const autoCleared = [{
    bank_txn: { id: "bank_2_0", date: "2026-06-12", vendor: "Acme Corp", amount: 2000 },
    invoice_ids: ["inv1"], match_type: "ar_clear", auto_clear: true, confidence: 97,
  }];

  const plan = planBankImport({ parsedTxns, autoCleared, queue: [], openItems: ledger, codes });

  it("clears the invoice — one match, nothing booked standalone", () => {
    expect(plan.clears).toHaveLength(1);
    expect(plan.clears[0]).toMatchObject({ invoiceId: "inv1", side: "ar" });
    expect(plan.standalone).toHaveLength(0);
    expect(plan.skipped).toHaveLength(0);
  });

  it("clearing is a balanced Dr Cash / Cr A/R; A/R relieved, Cash up, revenue unchanged", () => {
    const e = plan.clears[0].entry;
    expect(e.gl_code).toBe(CASH);          // Dr Cash
    expect(e.secondary_gl_code).toBe(AR);   // Cr A/R
    expect(e.amount).toBe(2000);

    expect(glAccountBalance(AR, ledger)).toBe(2000);     // before
    const after = [...ledger, ...plan.clears.map(clearRow)];
    expect(glAccountBalance(AR, after)).toBe(0);          // A/R fully relieved
    expect(glAccountBalance(CASH, after)).toBe(2000);     // Cash up by the amount
    expect(glAccountBalance(REV, after)).toBe(glAccountBalance(REV, ledger)); // net income unchanged
  });
});

describe("bank import — id:0 / rule rows can't diverge or double-book", () => {
  // Regression: the categorizer emits id:0 for the first row; a `t.id || …` fallback
  // treated it as falsy and regenerated a divergent id, so the matched row escaped the
  // skip filter and got booked standalone. Stable ids assigned upstream prevent this.
  const bill = {
    id: "bill1", vendor: "Nike", date: "2026-05-01", amount: 151.55, type: "expense",
    debit_credit: "debit", gl_code: EXP, secondary_gl_code: AP, status: "booked",
    payment_status: "unpaid", matched: false,
  };
  const parsedTxns = [{ id: "bank_9_0", vendor: "Nike", amount: 151.55, type: "expense", gl_code: EXP, date: "2026-06-10" }];
  const autoCleared = [{
    bank_txn: { id: "bank_9_0", date: "2026-06-10" }, invoice_ids: ["bill1"],
    match_type: "ap_clear", auto_clear: true,
  }];
  const plan = planBankImport({ parsedTxns, autoCleared, queue: [], openItems: [bill], codes });

  it("the matched line is held out of standalone booking", () => {
    expect(plan.standalone).toHaveLength(0);
    expect(plan.handledBankIds.has("bank_9_0")).toBe(true);
  });
});

describe("bank import — #3 no silent flag-without-GL", () => {
  // A bill booked DIRECT-TO-CASH (offset is Cash, not A/P) was already settled at
  // booking — a matching withdrawal can't post a clearing entry. It must go to review,
  // never flag-flipped, and never booked standalone.
  const directCashBill = {
    id: "bill2", vendor: "Coffee", date: "2026-05-01", amount: 12.5, type: "expense",
    debit_credit: "debit", gl_code: EXP, secondary_gl_code: CASH, status: "booked",
    payment_status: "paid", matched: false,
  };
  const parsedTxns = [{ id: "bank_3_0", vendor: "Coffee", amount: 12.5, type: "expense", gl_code: EXP, date: "2026-06-10" }];
  const autoCleared = [{
    bank_txn: { id: "bank_3_0", date: "2026-06-10" }, invoice_ids: ["bill2"],
    match_type: "ap_clear", auto_clear: true,
  }];
  const plan = planBankImport({ parsedTxns, autoCleared, queue: [], openItems: [directCashBill], codes });

  it("posts no clearing, routes to review, and does not book standalone", () => {
    expect(plan.clears).toHaveLength(0);          // no GL movement
    expect(plan.skipped).toHaveLength(1);         // surfaced
    expect(plan.review).toHaveLength(1);          // sent to manual review
    expect(plan.standalone).toHaveLength(0);      // not double-booked either
  });
});

describe("bank import — genuinely unmatched lines still book standalone", () => {
  const parsedTxns = [{ id: "bank_4_0", vendor: "New Vendor", amount: 40, type: "expense", gl_code: EXP, date: "2026-06-10" }];
  const plan = planBankImport({ parsedTxns, autoCleared: [], queue: [], openItems: [], codes });
  it("a line that matched nothing is booked as a new transaction", () => {
    expect(plan.clears).toHaveLength(0);
    expect(plan.standalone).toHaveLength(1);
    expect(plan.standalone[0].id).toBe("bank_4_0");
  });
});
