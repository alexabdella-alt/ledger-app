import { describe, it, expect } from "vitest";
import { planBankImport, isArMatch, buildBankLineEntry, reconRecordStatus, RECON_STATUSES, allClearingsPosted, shouldRunApMatching } from "../src/lib/bankMatch.js";
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

// ── #3 DIRECTION LOCK: deposits book Dr Cash / Cr Revenue, not inverted ───────
// Derive the two GL lines from the invoice-shaped entry exactly as persistJournalEntry
// does (isDebit = debit_credit !== "credit": primary debited, secondary credited; else
// primary credited, secondary debited).
const linesOf = e => {
  const isDebit = e.debit_credit !== "credit";
  return isDebit
    ? [{ code: e.gl_code, debit: e.amount, credit: 0 }, { code: e.secondary_gl_code, debit: 0, credit: e.amount }]
    : [{ code: e.gl_code, debit: 0, credit: e.amount }, { code: e.secondary_gl_code, debit: e.amount, credit: 0 }];
};
const debitOf = (lines, code) => lines.find(l => l.code === code)?.debit || 0;
const creditOf = (lines, code) => lines.find(l => l.code === code)?.credit || 0;

describe("buildBankLineEntry — direction by type (the deposit-inversion fix)", () => {
  it("a DEPOSIT (revenue, 4xxx) posts Dr Cash / Cr Revenue — NOT inverted", () => {
    const e = buildBankLineEntry({ type: "revenue", gl_code: "4000", gl_name: "Revenue", amount: 2500, vendor: "Bob", date: "2026-06-01", confidence: 90 }, { offsetCode: "1000", offsetName: "Cash" });
    expect(e.debit_credit).toBe("credit");        // primary (revenue) credited
    const lines = linesOf(e);
    expect(debitOf(lines, "1000")).toBe(2500);    // Dr Cash 2500
    expect(creditOf(lines, "4000")).toBe(2500);   // Cr Revenue 2500
    expect(debitOf(lines, "4000")).toBe(0);       // revenue is NOT debited (was the bug)
    expect(creditOf(lines, "1000")).toBe(0);      // cash is NOT credited (was the bug)
    const d = lines.reduce((s, l) => s + l.debit, 0), c = lines.reduce((s, l) => s + l.credit, 0);
    expect(d).toBe(c);                            // balanced
  });

  it("an EXPENSE (6xxx) still posts Dr Expense / Cr Cash (unchanged)", () => {
    const e = buildBankLineEntry({ type: "expense", gl_code: "6500", amount: 151.55, date: "2026-06-01" }, { offsetCode: "1000" });
    expect(e.debit_credit).toBe("debit");
    const lines = linesOf(e);
    expect(debitOf(lines, "6500")).toBe(151.55);  // Dr Expense
    expect(creditOf(lines, "1000")).toBe(151.55); // Cr Cash
  });

  it("uses abs(amount) and Cash as the offset for both", () => {
    const dep = buildBankLineEntry({ type: "revenue", gl_code: "4000", amount: -2500 }, { offsetCode: "1000" });
    expect(dep.amount).toBe(2500);
    expect(dep.secondary_gl_code).toBe("1000");
  });
});

// ── #1 DISMISS LOCK: a dismissed match still books, correct direction ─────────
describe("dismiss-book reuses buildBankLineEntry (the same correct shape)", () => {
  it("a dismissed DEPOSIT books a balanced Dr Cash / Cr Revenue entry", () => {
    // dismissMatch builds: buildBankLineEntry(m.bank_txn, { offsetCode, offsetName, reason })
    const bankTxn = { id: "b1", type: "revenue", gl_code: "4000", gl_name: "Revenue", amount: 2500, vendor: "Bob", date: "2026-06-01" };
    const e = buildBankLineEntry(bankTxn, { offsetCode: "1000", offsetName: "Cash", reason: "Booked directly — proposed match dismissed" });
    expect(e.reasoning).toMatch(/dismissed/);
    expect(e.source).toBe("bank_statement");
    const lines = linesOf(e);
    expect(debitOf(lines, "1000")).toBe(2500);    // Dr Cash — income recorded, not stranded
    expect(creditOf(lines, "4000")).toBe(2500);   // Cr Revenue
  });
});

// ── #2 RECON STATUS LOCK: never write a value the CHECK rejects ───────────────
describe("reconRecordStatus — only CHECK-allowed values (open|complete)", () => {
  it("review items present → 'open' (was 'needs_review', which violated the CHECK)", () => {
    expect(reconRecordStatus(2)).toBe("open");
    expect(reconRecordStatus(1)).toBe("open");
  });
  it("no review items → 'complete'", () => {
    expect(reconRecordStatus(0)).toBe("complete");
  });
  it("the chosen status is always in the reconciliations CHECK set; 'needs_review' is not", () => {
    expect(RECON_STATUSES).toContain(reconRecordStatus(3));
    expect(RECON_STATUSES).toContain(reconRecordStatus(0));
    expect(RECON_STATUSES).not.toContain("needs_review");
  });
});

// ── O57: offset follows the import ACCOUNT (card → 2200, bank → 1000) ─────────
describe("buildBankLineEntry — offset by account (credit-card vs bank)", () => {
  const off = (e) => e.secondary_gl_code;
  const linesO = e => {
    const isDebit = e.debit_credit !== "credit";
    return isDebit
      ? [{ code: e.gl_code, debit: e.amount, credit: 0 }, { code: e.secondary_gl_code, debit: 0, credit: e.amount }]
      : [{ code: e.gl_code, debit: 0, credit: e.amount }, { code: e.secondary_gl_code, debit: e.amount, credit: 0 }];
  };

  it("a CREDIT-CARD account import books Dr Expense / Cr 2200 (liability), not Cr Cash", () => {
    const e = buildBankLineEntry({ type: "expense", gl_code: "6500", amount: 80, vendor: "Adobe", date: "2026-06-01" },
      { offsetCode: "2200", offsetName: "Credit Card Liability" });
    expect(off(e)).toBe("2200");
    const lines = linesO(e);
    expect(lines.find(l => l.code === "6500").debit).toBe(80);   // Dr Expense
    expect(lines.find(l => l.code === "2200").credit).toBe(80);  // Cr Credit Card Liability
    expect(lines.find(l => l.code === "1000")).toBeUndefined();  // NOT cash
  });

  it("a BANK (checking) account import books Dr Expense / Cr 1000 (cash)", () => {
    const e = buildBankLineEntry({ type: "expense", gl_code: "6500", amount: 80 }, { offsetCode: "1000", offsetName: "Cash" });
    expect(off(e)).toBe("1000");
    expect(linesO(e).find(l => l.code === "1000").credit).toBe(80);
  });

  it("defaults to Cash when no account/offset is given (legacy)", () => {
    expect(buildBankLineEntry({ type: "expense", gl_code: "6500", amount: 80 }).secondary_gl_code).toBe("1000");
  });

  it("DISMISS path (C60 interaction): a dismissed credit-card line books Dr Expense / Cr 2200", () => {
    // dismissMatch reuses buildBankLineEntry with the queued match's importOffsetCode.
    const e = buildBankLineEntry({ type: "expense", gl_code: "6500", amount: 80, vendor: "Adobe" },
      { offsetCode: "2200", offsetName: "Credit Card Liability", reason: "Booked directly — proposed match dismissed" });
    expect(e.secondary_gl_code).toBe("2200");
    expect(e.reasoning).toMatch(/dismissed/);
    const lines = linesO(e);
    expect(lines.find(l => l.code === "2200").credit).toBe(80);  // not Cash
  });
});

// ── O69-B: a match is "cleared" ONLY if every clearing JE actually committed ──────
// markBillPaid returns false (no JE) for a local-only / unpersisted id. applyMatch
// must NOT record success / show "payment posted ✓" on a write that didn't happen.
describe("allClearingsPosted — never claim a write that didn't commit (false-completeness fix)", () => {
  it("every post succeeded → cleared", () => {
    expect(allClearingsPosted([true])).toBe(true);
    expect(allClearingsPosted([true, true])).toBe(true);
  });
  it("any failed post → NOT cleared (left in review, no success)", () => {
    expect(allClearingsPosted([false])).toBe(false);
    expect(allClearingsPosted([true, false])).toBe(false);
    expect(allClearingsPosted([false, true])).toBe(false);
  });
  it("no posts at all → NOT cleared (the exact bug: 'AP Cleared' with zero journal entries)", () => {
    expect(allClearingsPosted([])).toBe(false);
  });
  it("non-array / garbage → NOT cleared (defensive)", () => {
    expect(allClearingsPosted(null)).toBe(false);
    expect(allClearingsPosted(undefined)).toBe(false);
    expect(allClearingsPosted("ok")).toBe(false);
  });
});

// ── O69-C: a credit-card charge ≠ an AP payment, so card imports skip AP-matching ──
describe("shouldRunApMatching — card imports skip matching; bank imports keep it", () => {
  it("a credit-card account → DOES NOT run AP-matching (charges direct-book Dr Expense / Cr 2200)", () => {
    expect(shouldRunApMatching({ type: "credit_card" })).toBe(false);
  });
  it("a bank account (checking/savings) → DOES run AP-matching (a debit can clear a bill)", () => {
    expect(shouldRunApMatching({ type: "checking" })).toBe(true);
    expect(shouldRunApMatching({ type: "savings" })).toBe(true);
  });
  it("loan / other → run matching (only credit_card is excluded)", () => {
    expect(shouldRunApMatching({ type: "loan" })).toBe(true);
    expect(shouldRunApMatching({ type: "other" })).toBe(true);
  });
  it("missing/unknown account → defaults to bank behavior (matching on, safe & reviewable)", () => {
    expect(shouldRunApMatching(null)).toBe(true);
    expect(shouldRunApMatching(undefined)).toBe(true);
    expect(shouldRunApMatching({})).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P0 — bank import must book each line EXACTLY ONCE (never N×N).
// The catastrophic shakedown bug: importing a 12-line statement produced each
// unmatched line ~12 times (12 = the line count) — the signature of the "book the
// unmatched set" step running once PER parsed line instead of once over the set.
// planBankImport is the pure partition that decides what gets booked: it must split
// the N parsed lines into clears (matched) + standalone (new) + review with each
// line landing in exactly ONE bucket and no duplicates — so the total bookings are
// |clears| + |standalone| ≤ N, structurally never N×N. (The handler also carries a
// re-entrancy guard so a second invocation can't re-book the same set.)
// ─────────────────────────────────────────────────────────────────────────────
describe("planBankImport — N lines → N bookings, never N×N (P0 duplication guard)", () => {
  // 12 parsed lines: 3 will match open bills (clear), 9 are genuinely new (standalone).
  const N = 12;
  const parsedTxns = Array.from({ length: N }, (_, i) => ({
    id: `bank_run_${i}`, vendor: `Vendor ${i}`, description: `LINE ${i}`,
    date: "2026-06-10", amount: 100 + i, type: "expense", gl_code: EXP, gl_name: "Travel",
  }));
  // Three open A/P bills the matching engine clears (indices 0,5,11).
  const matchedIdx = [0, 5, 11];
  const openItems = matchedIdx.map(i => ({
    id: `bill${i}`, vendor: `Vendor ${i}`, date: "2026-05-01", amount: 100 + i, type: "expense",
    debit_credit: "debit", gl_code: EXP, secondary_gl_code: AP, status: "booked",
    payment_status: "unpaid", matched: false,
  }));
  const autoCleared = matchedIdx.map(i => ({
    bank_txn: { id: `bank_run_${i}`, date: "2026-06-10", vendor: `Vendor ${i}`, amount: -(100 + i) },
    invoice_ids: [`bill${i}`], match_type: "ap_clear", auto_clear: true, confidence: 98,
  }));

  const plan = planBankImport({ parsedTxns, autoCleared, queue: [], openItems, codes });

  it("partitions all N lines: |clears| + |standalone| + |review| === N, no line counted twice", () => {
    const total = plan.clears.length + plan.standalone.length + plan.review.length;
    expect(total).toBe(N);                    // every line bucketed once — not N more per line
    expect(plan.clears).toHaveLength(3);      // the 3 matched → clearing only
    expect(plan.standalone).toHaveLength(9);  // the 9 new → direct-book only
  });

  it("standalone has NO duplicate ids (each unmatched line booked exactly once)", () => {
    const ids = plan.standalone.map(t => String(t.id));
    expect(new Set(ids).size).toBe(ids.length);              // no dupes
    expect(ids.length).toBe(9);                              // 9, not 9×12=108
  });

  it("matched lines are ABSENT from standalone (cleared, never also direct-booked)", () => {
    const standaloneIds = new Set(plan.standalone.map(t => String(t.id)));
    for (const i of matchedIdx) expect(standaloneIds.has(`bank_run_${i}`)).toBe(false);
    // and they DID clear — they didn't silently post nothing
    expect(plan.clears.map(c => c.bankId).sort()).toEqual(["bank_run_0", "bank_run_11", "bank_run_5"].sort());
  });

  it("total bookings (clears + standalone) === N, the no-N×N invariant", () => {
    expect(plan.clears.length + plan.standalone.length).toBe(N);   // 3 + 9 = 12, never 144
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P0 #2 — matched lines must be excluded from standalone even when the bank_txn
// OBJECT didn't resolve. The live double-count: handleBankFile gave each line a
// 13-digit numeric id; the matching LLM echoed it back as a STRING, so
// runMatchingEngine's strict-=== `bank_txn` lookup returned undefined, planBankImport
// saw `m.bank_txn?.id == null`, and the matched line stayed in `standalone` → booked
// TWICE (once as the clearing 'manual' entry, once as a mis-coded 'bank_import' entry:
// Riverside hit Revenue, Pixel hit Expense). Fix: planBankImport falls back to the flat
// `bank_txn_id` echo; id type mismatches are String()-coerced. These tests feed the
// exact broken shape (no bank_txn object, only bank_txn_id) and a number/string id
// mismatch, asserting the matched line is held out of standalone either way.
// ─────────────────────────────────────────────────────────────────────────────
describe("planBankImport — matched line excluded even when bank_txn object is unresolved (P0 double-count)", () => {
  // The shakedown company's exact shape: Acme + Riverside collections (AR), Pixel payment (AP),
  // plus one genuinely-new line. Open AR also has an untouched Globex invoice (6,800) so we can
  // assert the residual. ALL ids numeric (as live), and autoCleared carries ONLY bank_txn_id
  // (the find failed → no bank_txn object) — the precise failure mode.
  const openItems = [
    { id: "acme",     vendor: "Acme Corp",   date: "2026-05-01", amount: 4500, type: "revenue", debit_credit: "credit", gl_code: REV, secondary_gl_code: AR, status: "booked", payment_status: "uncollected", matched: false },
    { id: "riverside",vendor: "Riverside",   date: "2026-05-02", amount: 1284, type: "revenue", debit_credit: "credit", gl_code: REV, secondary_gl_code: AR, status: "booked", payment_status: "uncollected", matched: false },
    { id: "globex",   vendor: "Globex",      date: "2026-05-03", amount: 6800, type: "revenue", debit_credit: "credit", gl_code: REV, secondary_gl_code: AR, status: "booked", payment_status: "uncollected", matched: false },
    { id: "pixel",    vendor: "Pixel Labs",  date: "2026-05-04", amount: 1800, type: "expense", debit_credit: "debit",  gl_code: EXP, secondary_gl_code: AP, status: "booked", payment_status: "unpaid",       matched: false },
  ];
  // 4 parsed bank lines: 3 match (Acme/Riverside/Pixel), 1 is genuinely new. Numeric ids, as live.
  const parsedTxns = [
    { id: 1719500000000, vendor: "Acme Corp",  description: "ACH DEPOSIT ACME",   date: "2026-06-10", amount: 4500, type: "revenue", gl_code: REV, gl_name: "Revenue" },
    { id: 1719500000001, vendor: "Riverside",  description: "ACH DEPOSIT RIVER",  date: "2026-06-11", amount: 1284, type: "revenue", gl_code: REV, gl_name: "Revenue" },
    { id: 1719500000002, vendor: "Pixel Labs", description: "ACH PMT PIXEL",      date: "2026-06-12", amount: 1800, type: "expense", gl_code: EXP, gl_name: "Professional Services" },
    { id: 1719500000003, vendor: "New Vendor", description: "POS NEW VENDOR",     date: "2026-06-13", amount:  250, type: "expense", gl_code: EXP, gl_name: "Travel" },
  ];
  // Engine output AS PRODUCED in the bug: NO bank_txn object (strict-=== find failed), only the
  // flat bank_txn_id echoed back as a STRING (number→string round-trip through the LLM).
  const autoCleared = [
    { bank_txn_id: "1719500000000", bank_txn: undefined, invoice_ids: ["acme"],      match_type: "ar_clear", auto_clear: true, confidence: 98 },
    { bank_txn_id: "1719500000001", bank_txn: undefined, invoice_ids: ["riverside"], match_type: "ar_clear", auto_clear: true, confidence: 98 },
    { bank_txn_id: "1719500000002", bank_txn: undefined, invoice_ids: ["pixel"],     match_type: "ap_clear", auto_clear: true, confidence: 98 },
  ];

  const plan = planBankImport({ parsedTxns, autoCleared, queue: [], openItems, codes });

  it("N=4, K=3 matched → 3 clears + 1 standalone = 4 bookings; NO line booked both ways", () => {
    expect(plan.clears).toHaveLength(3);
    expect(plan.standalone).toHaveLength(1);                         // only the genuinely-new line
    expect(plan.clears.length + plan.standalone.length).toBe(4);     // N total — not N+K (the double-book)
    const standaloneIds = plan.standalone.map(t => String(t.id));
    expect(standaloneIds).toEqual(["1719500000003"]);               // the 3 matched lines are NOT here
    for (const id of ["1719500000000", "1719500000001", "1719500000002"])
      expect(standaloneIds).not.toContain(id);
  });

  it("AR clears to the CORRECT residual 6,800 (not 2,300 — Acme is not credited twice)", () => {
    expect(glAccountBalance(AR, openItems)).toBe(12584);            // before: 4500+1284+6800
    const after = [...openItems, ...plan.clears.filter(c => c.side === "ar").map(clearRow)];
    expect(glAccountBalance(AR, after)).toBe(6800);                 // after: only Acme+Riverside cleared, once each
  });

  it("AP clears Pixel fully (1,800 → 0), each matched line clears exactly once", () => {
    expect(glAccountBalance(AP, openItems)).toBe(1800);
    const after = [...openItems, ...plan.clears.filter(c => c.side === "ap").map(clearRow)];
    expect(glAccountBalance(AP, after)).toBe(0);
  });
});

describe("planBankImport — id type mismatch between parsed line and engine echo (String-coerced)", () => {
  const openItems = [{ id: "bill1", vendor: "Nike", date: "2026-05-01", amount: 100, type: "expense", debit_credit: "debit", gl_code: EXP, secondary_gl_code: AP, status: "booked", payment_status: "unpaid", matched: false }];
  // Parsed line id is a NUMBER; engine echoes a STRING. Must still exclude from standalone.
  const parsedTxns = [{ id: 42, vendor: "Nike", description: "ACH NIKE", date: "2026-06-10", amount: 100, type: "expense", gl_code: EXP, gl_name: "Travel" }];
  const autoCleared = [{ bank_txn_id: "42", bank_txn: undefined, invoice_ids: ["bill1"], match_type: "ap_clear", auto_clear: true, confidence: 98 }];
  const plan = planBankImport({ parsedTxns, autoCleared, queue: [], openItems, codes });
  it("number id vs string echo → still excluded (no double-book)", () => {
    expect(plan.clears).toHaveLength(1);
    expect(plan.standalone).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MATCHING COVERAGE (deterministic pass). The LLM matcher missed 2 of 3 real
// matches: Riverside ("Riverside Cafe (Maria)" invoice vs "Riverside Cafe" bank —
// parenthetical) and Pixel (near-exact name + exact amount on the A/P payment side).
// autoMatchBankLines pairs by normalized party name + exact amount, symmetric across
// A/R deposits and A/P payments, so all three clear and AR→6,800 / AP→0.
// ─────────────────────────────────────────────────────────────────────────────
import { autoMatchBankLines } from "../src/lib/bankMatch.js";

describe("autoMatchBankLines — tolerant name + exact amount, symmetric A/R and A/P", () => {
  const openItems = [
    { id: "acme",      vendor: "Acme Corp",            amount: 4500, type: "revenue", payment_status: "uncollected", matched: false },
    { id: "riverside", vendor: "Riverside Cafe (Maria)", amount: 1284, type: "revenue", payment_status: "uncollected", matched: false },
    { id: "pixel",     vendor: "Pixel Contractor LLC", amount: 1800, type: "expense", payment_status: "unpaid",       matched: false },
  ];
  const parsedTxns = [
    { id: "b0", vendor: "ACME CORP",         description: "ACME CORP INV PAYMENT",     amount: 4500, type: "revenue" },
    { id: "b1", vendor: "Riverside Cafe",    description: "RIVERSIDE CAFE PAYMENT",    amount: 1284, type: "revenue" },
    { id: "b2", vendor: "Pixel Contractor",  description: "PIXEL CONTRACTOR LLC",      amount: 1800, type: "expense" },
  ];

  const m = autoMatchBankLines(parsedTxns, openItems);

  it("matches ALL THREE (Acme, Riverside parenthetical, Pixel A/P side)", () => {
    expect(m).toHaveLength(3);
    const byBank = Object.fromEntries(m.map(x => [x.bank_txn_id, x]));
    expect(byBank.b0.invoice_ids).toEqual(["acme"]);
    expect(byBank.b1.invoice_ids).toEqual(["riverside"]);   // parenthetical tolerated
    expect(byBank.b2.invoice_ids).toEqual(["pixel"]);       // LLC suffix tolerated, A/P side
  });

  it("assigns the correct side: deposit→ar_clear, payment→ap_clear", () => {
    const byBank = Object.fromEntries(m.map(x => [x.bank_txn_id, x]));
    expect(byBank.b0.match_type).toBe("ar_clear");
    expect(byBank.b1.match_type).toBe("ar_clear");
    expect(byBank.b2.match_type).toBe("ap_clear");
  });

  it("carries bank_txn + bank_txn_id so planBankImport excludes them from standalone", () => {
    for (const x of m) { expect(x.bank_txn).toBeTruthy(); expect(x.bank_txn_id).toBeTruthy(); expect(x.auto_clear).toBe(true); }
  });

  it("requires the amount to match — a same-name line with a different amount does NOT match", () => {
    const res = autoMatchBankLines(
      [{ id: "x", vendor: "Acme Corp", amount: 4499, type: "revenue" }],   // $1 off
      [{ id: "acme", vendor: "Acme Corp", amount: 4500, type: "revenue" }]
    );
    expect(res).toHaveLength(0);
  });

  it("does not cross sides — a deposit never clears an open payable of the same amount/name", () => {
    const res = autoMatchBankLines(
      [{ id: "x", vendor: "Pixel Contractor", amount: 1800, type: "revenue" }],   // deposit
      [{ id: "pixel", vendor: "Pixel Contractor LLC", amount: 1800, type: "expense" }]  // payable
    );
    expect(res).toHaveLength(0);
  });

  it("clears each open item only once (two identical bank lines → one match)", () => {
    const res = autoMatchBankLines(
      [{ id: "a", vendor: "Acme", amount: 4500, type: "revenue" }, { id: "b", vendor: "Acme", amount: 4500, type: "revenue" }],
      [{ id: "acme", vendor: "Acme Corp", amount: 4500, type: "revenue" }]
    );
    expect(res).toHaveLength(1);   // only one line clears the single open invoice
  });

  it("end-to-end through planBankImport → AR clears to 6,800, AP to 0, no standalone double-book", () => {
    const ledger = [
      { id: "acme",      vendor: "Acme Corp",             date: "2026-05-01", amount: 4500, type: "revenue", debit_credit: "credit", gl_code: REV, secondary_gl_code: AR, status: "booked", payment_status: "uncollected", matched: false },
      { id: "riverside", vendor: "Riverside Cafe (Maria)",date: "2026-05-02", amount: 1284, type: "revenue", debit_credit: "credit", gl_code: REV, secondary_gl_code: AR, status: "booked", payment_status: "uncollected", matched: false },
      { id: "globex",    vendor: "Globex",                date: "2026-05-03", amount: 6800, type: "revenue", debit_credit: "credit", gl_code: REV, secondary_gl_code: AR, status: "booked", payment_status: "uncollected", matched: false },
      { id: "pixel",     vendor: "Pixel Contractor LLC",  date: "2026-05-04", amount: 1800, type: "expense", debit_credit: "debit",  gl_code: EXP, secondary_gl_code: AP, status: "booked", payment_status: "unpaid",       matched: false },
    ];
    const parsed = [
      { id: "b0", vendor: "ACME CORP",        description: "ACME CORP INV PAYMENT",  date: "2026-06-10", amount: 4500, type: "revenue", gl_code: REV, gl_name: "Revenue" },
      { id: "b1", vendor: "Riverside Cafe",   description: "RIVERSIDE CAFE PAYMENT", date: "2026-06-11", amount: 1284, type: "revenue", gl_code: REV, gl_name: "Revenue" },
      { id: "b2", vendor: "Pixel Contractor", description: "PIXEL CONTRACTOR LLC",   date: "2026-06-12", amount: 1800, type: "expense", gl_code: EXP, gl_name: "Professional Services" },
    ];
    const autoCleared = autoMatchBankLines(parsed, ledger);
    const plan = planBankImport({ parsedTxns: parsed, autoCleared, queue: [], openItems: ledger, codes });

    expect(plan.clears).toHaveLength(3);
    expect(plan.standalone).toHaveLength(0);   // all matched → nothing direct-booked
    const after = [...ledger, ...plan.clears.map(clearRow)];
    expect(glAccountBalance(AR, after)).toBe(6800);   // 12,584 − 4,500 − 1,284
    expect(glAccountBalance(AP, after)).toBe(0);       // Pixel cleared
  });
});
