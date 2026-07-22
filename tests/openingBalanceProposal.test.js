import { describe, it, expect } from "vitest";
import {
  deriveStatementOpening, shouldProposeOpening, openingDiscrepancy,
  markAlreadyBooked, bankTxnKey, bankLineDirection, bookedLineDirection,
  openingProposalCopy, periodMonthLabel, resolveAdoptedBalance,
} from "../src/lib/openingBalanceProposal.js";
import { isPlaceholderBank, onboardingSteps } from "../src/lib/onboarding.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";
import { buildBankLineEntry } from "../src/lib/bankMatch.js";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../src/lib/constants.js";

// ════════════════════════════════════════════════════════════════════════════
// O83 — derive the CASH opening balance from an uploaded bank statement (clients
// should never type a number printed on a document they already gave us).
// The January statement states "Opening balance 01/01/2026: $12,483.27"; booking
// only the 20 lines left cash at net-change-only ($3,174.33 instead of $15,657.60).
// ════════════════════════════════════════════════════════════════════════════

// A realistic slice of the January statement (signed amounts + running balance).
const JAN = {
  statedOpening: 12483.27,
  statedPeriodStart: "2026-01-01",
  // opening 12,483.27 → after a -100 debit the running balance is 12,383.27, etc.
  transactions: [
    { date: "2026-01-03", description: "ACH DEBIT RENT", amount: -100.00, balance: 12383.27 },
    { date: "2026-01-10", description: "DEPOSIT CLIENT", amount: 3500.00, balance: 15883.27 },
    { date: "2026-01-20", description: "CARD PURCHASE AWS", amount: -225.67, balance: 15657.60 },
  ],
};

describe("deriveStatementOpening — stated + derived, cross-checked", () => {
  it("uses the STATED opening when present and cross-checks the running balance (they agree)", () => {
    const r = deriveStatementOpening(JAN);
    expect(r.ok).toBe(true);
    expect(r.openingBalance).toBe(12483.27);
    expect(r.periodStart).toBe("2026-01-01");
    expect(r.derived).toBe(12483.27);       // 12383.27 − (−100.00)
    expect(r.mismatch).toBe(false);
    expect(r.source).toBe("both");
  });

  it("DERIVES from the first transaction's running balance when no stated figure", () => {
    const r = deriveStatementOpening({ transactions: JAN.transactions });
    expect(r.openingBalance).toBe(12483.27);
    expect(r.periodStart).toBe("2026-01-03");   // falls back to first txn date
    expect(r.source).toBe("derived");
  });

  it("FLAGS a mismatch when stated and derived disagree (never silently guesses)", () => {
    const r = deriveStatementOpening({ ...JAN, statedOpening: 9999.00 });
    expect(r.mismatch).toBe(true);
    expect(r.openingBalance).toBe(9999.00);     // surfaces the stated figure, but flags it
    expect(r.stated).toBe(9999.00);
    expect(r.derived).toBe(12483.27);
  });

  it("returns not-ok when there's nothing to derive from", () => {
    expect(deriveStatementOpening({ transactions: [] }).ok).toBe(false);
  });

  it("returns the statement ENDING balance (last running balance)", () => {
    expect(deriveStatementOpening(JAN).endingBalance).toBe(15657.60);   // last txn's running balance
  });
  it("derives the ending from opening + net when there's no running-balance column", () => {
    const noRunning = { statedOpening: 1000, statedPeriodStart: "2026-01-01",
      transactions: [{ date: "2026-01-05", amount: -100 }, { date: "2026-01-10", amount: 250 }] };
    expect(deriveStatementOpening(noRunning).endingBalance).toBe(1150);   // 1000 − 100 + 250
  });
});

// ── O83 checklist residual: confirming an opening ADOPTS the account (current_balance = ending) ──
describe("resolveAdoptedBalance — statement ending balance marks the account adopted", () => {
  it("SET: a seeded $0 account adopts the statement ending balance", () => {
    expect(resolveAdoptedBalance({ existingBalance: 0, endingBalance: 15657.60 })).toEqual({ action: "set", value: 15657.60 });
    expect(resolveAdoptedBalance({ existingBalance: "", endingBalance: 15657.60 }).action).toBe("set");
  });
  it("KEEP: a user balance that already matches the ending → no-op", () => {
    expect(resolveAdoptedBalance({ existingBalance: 15657.60, endingBalance: 15657.60 }).action).toBe("keep");
  });
  it("MISMATCH: a DIFFERENT user-typed balance is left untouched, difference surfaced", () => {
    const d = resolveAdoptedBalance({ existingBalance: 9000, endingBalance: 15657.60 });
    expect(d.action).toBe("mismatch");
    expect(d.value).toBe(9000);          // kept
    expect(d.ending).toBe(15657.60);
    expect(d.diff).toBe(-6657.60);
  });
  it("NONE: no usable ending balance → no change", () => {
    expect(resolveAdoptedBalance({ existingBalance: 0, endingBalance: null }).action).toBe("none");
  });
});

describe("checklist effect: adopted account clears the placeholder + ticks obHasBank", () => {
  const seeded = { id: "acc1", name: "Primary Checking", institution: "", last4: "", current_balance: 0 };
  it("CONFIRM → current_balance = statement ending → not a placeholder → obHasBank true", () => {
    const decision = resolveAdoptedBalance({ existingBalance: seeded.current_balance, endingBalance: 15657.60 });
    const adopted = { ...seeded, current_balance: decision.value };   // what confirm writes
    expect(isPlaceholderBank(adopted)).toBe(false);
    expect(onboardingSteps({ bankAccounts: [adopted] }).obHasBank).toBe(true);
  });
  it("NOT NOW → account untouched ($0) → still a placeholder → obHasBank false", () => {
    expect(isPlaceholderBank(seeded)).toBe(true);
    expect(onboardingSteps({ bankAccounts: [seeded] }).obHasBank).toBe(false);
  });
  it("pre-existing non-zero balance → untouched (kept), account already real", () => {
    const typed = { ...seeded, current_balance: 9000 };
    expect(resolveAdoptedBalance({ existingBalance: typed.current_balance, endingBalance: 15657.60 }).action).toBe("mismatch");
    expect(onboardingSteps({ bankAccounts: [typed] }).obHasBank).toBe(true);   // non-zero → already non-placeholder
  });
});

describe("shouldProposeOpening — only when there's no opening + no earlier books", () => {
  it("fresh company (no opening, no earlier entries) → propose", () => {
    expect(shouldProposeOpening({ hasOpeningForAccount: false, earliestBookedDate: "2026-01-05", periodStart: "2026-01-01" })).toBe(true);
  });
  it("an opening already exists → do NOT propose (avoids a second opening)", () => {
    expect(shouldProposeOpening({ hasOpeningForAccount: true, earliestBookedDate: null, periodStart: "2026-01-01" })).toBe(false);
  });
  it("books predate the statement start → do NOT propose (not the true opening)", () => {
    expect(shouldProposeOpening({ hasOpeningForAccount: false, earliestBookedDate: "2025-12-20", periodStart: "2026-01-01" })).toBe(false);
  });
});

describe("openingDiscrepancy — existing opening vs statement (never auto-adjust)", () => {
  it("mismatch beyond tolerance → flagged", () => {
    const d = openingDiscrepancy({ statedOpening: 12483.27, recordedOpening: 10000.00 });
    expect(d.mismatch).toBe(true);
    expect(d.diff).toBe(2483.27);
  });
  it("agree within tolerance → not flagged", () => {
    expect(openingDiscrepancy({ statedOpening: 12483.27, recordedOpening: 12483.28 }).mismatch).toBe(false);
  });
});

// ── INTEGRATION: book through the REAL path shape, then re-parse (O83 regression) ──
// The unit tests that passed in production fed synthetic invoices shaped to the OLD key.
// This books lines through the ACTUAL builder (buildBankLineEntry) + the ACTUAL flatten
// (flattenJournalEntries) — the exact fields bookBankTransactions/loadAllData write —
// then re-parses the SAME statement and asserts EVERY line is flagged already-booked.
// It reproduces the live failure: cleaned vendor + rewritten memo + GL re-categorization.
describe("markAlreadyBooked — INTEGRATION against the real booking path (O83 double-book fix)", () => {
  const nameOf = (code) => (DEFAULT_CHART_OF_ACCOUNTS.find(a => a.code === code)?.name) || code;
  // The Franklin Ave January statement lines (raw bank memos, as re-parsed). Signed amounts.
  const STATEMENT = [
    { date: "2026-01-02", description: "TOAST POS DEPOSIT 010226", vendor: "Toast POS", amount: 1842.66, type: "revenue", gl_code: "4000" },
    { date: "2026-01-13", description: "TOAST POS DEPOSIT 011326", vendor: "Toast POS", amount: 2286.90, type: "revenue", gl_code: "4000" },
    { date: "2026-01-15", description: "GUSTO PAYROLL 011526", vendor: "Gusto Payroll", amount: -3150.00, type: "expense", gl_code: "6000" },
    { date: "2026-01-22", description: "ACH DEBIT - THE HARTLINE INSURANCE GROUP", vendor: "The Hartline Insurance Group", amount: -264.50, type: "expense", gl_code: "6700" },
    { date: "2026-01-21", description: "ACH DEBIT - LONE STAR RESTAURANT SUPPLY", vendor: "Lone Star Restaurant Supply", amount: -1102.88, type: "expense", gl_code: "5000" },
    { date: "2026-01-31", description: "MONTHLY SERVICE FEE", vendor: "Bank", amount: -15.00, type: "expense", gl_code: "8000" },   // note: GL 8000 on first run
  ];

  // Book each line the way bookBankTransactions does, then persist+reload shape: the DB
  // description becomes `${vendor} – ${rawMemo}` (App.jsx:1206) and the ledger is flattened.
  const bookAndFlatten = (lines) => {
    const dbEntries = lines.map((t, i) => {
      const e = buildBankLineEntry(
        { id: `b${i}`, date: t.date, description: t.description, vendor: t.vendor, amount: t.amount, type: t.type, gl_code: t.gl_code, gl_name: nameOf(t.gl_code) },
        { offsetCode: "1000", offsetName: "Cash & Cash Equivalents" }
      );
      const amt = Math.abs(Number(t.amount));
      const isDebit = e.debit_credit !== "credit";   // primary(gl_code) debited?
      const line = (code, dr, cr) => ({ debit: dr, credit: cr, accounts: { code, name: nameOf(code) } });
      const lines2 = isDebit
        ? [line(e.gl_code, amt, 0), line(e.secondary_gl_code, 0, amt)]
        : [line(e.gl_code, 0, amt), line(e.secondary_gl_code, amt, 0)];
      return { id: `je${i}`, entry_date: t.date, description: `${t.vendor} – ${t.description}`, source: "bank_import", status: "posted", journal_entry_lines: lines2 };
    });
    return flattenJournalEntries(dbEntries, DEFAULT_CHART_OF_ACCOUNTS);
  };

  it("re-uploading the SAME statement flags ALL lines already-booked (was: 0 of them)", () => {
    const existing = bookAndFlatten(STATEMENT);
    // sanity: the booked rows really are cleaned/rewritten (vendor ≠ raw memo)
    expect(existing.find(r => r.vendor === "Toast POS")).toBeTruthy();
    const reparsed = markAlreadyBooked(STATEMENT, existing, { offsetCode: "1000" });
    expect(reparsed.every(t => t.already_booked)).toBe(true);
    expect(reparsed.filter(t => !t.already_booked).length).toBe(0);   // NONE re-books
  });

  it("survives GL re-categorization run-to-run (bank fee 8000 → 7100) — key is GL-free", () => {
    const existing = bookAndFlatten(STATEMENT);                         // booked with 8000
    const reparsed = STATEMENT.map(t => t.gl_code === "8000" ? { ...t, gl_code: "7100" } : t);   // re-parse says 7100
    const marked = markAlreadyBooked(reparsed, existing, { offsetCode: "1000" });
    expect(marked.every(t => t.already_booked)).toBe(true);            // still flagged despite the GL flip
  });

  it("a genuinely NEW line still books; multiset caps flags at the count that exist", () => {
    const existing = bookAndFlatten(STATEMENT);
    const withNew = [...STATEMENT, { date: "2026-01-25", description: "SQ *NEW VENDOR", vendor: "New Vendor", amount: -50, type: "expense", gl_code: "6600" }];
    const marked = markAlreadyBooked(withNew, existing, { offsetCode: "1000" });
    expect(marked.filter(t => !t.already_booked).length).toBe(1);
    expect(marked.find(t => t.vendor === "New Vendor").already_booked).toBe(false);
  });

  it("direction: a deposit is NOT deduped against an equal-amount, same-day withdrawal", () => {
    const dep = { date: "2026-03-01", description: "DEPOSIT", vendor: "X", amount: 100, type: "revenue", gl_code: "4000" };
    const wd = { date: "2026-03-01", description: "WITHDRAWAL", vendor: "Y", amount: -100, type: "expense", gl_code: "6600" };
    const existing = bookAndFlatten([dep]);                            // only the deposit is booked
    const marked = markAlreadyBooked([dep, wd], existing, { offsetCode: "1000" });
    expect(marked.find(t => t.description === "DEPOSIT").already_booked).toBe(true);
    expect(marked.find(t => t.description === "WITHDRAWAL").already_booked).toBe(false);   // different direction
  });

  it("direction helpers agree on both sides", () => {
    expect(bankLineDirection({ type: "revenue" })).toBe("in");
    expect(bankLineDirection({ type: "expense" })).toBe("out");
    expect(bankLineDirection({ amount: -5 })).toBe("out");
    // flattened expense (Dr 6xxx / Cr 1000): cash on offset → out
    expect(bookedLineDirection({ gl_code: "6700", secondary_gl_code: "1000", debit_credit: "debit" }, "1000")).toBe("out");
    // flattened revenue (Dr 1000 / Cr 4000 → flatten primary = revenue credit): cash on offset debit → in
    expect(bookedLineDirection({ gl_code: "4000", secondary_gl_code: "1000", debit_credit: "credit" }, "1000")).toBe("in");
  });
});

describe("openingProposalCopy — plain language, jargon-free", () => {
  const copy = openingProposalCopy({ openingBalance: 12483.27, periodStart: "2026-01-01", accountName: "checking" });
  it("reads like the spec example", () => {
    expect(copy).toBe("Your statement shows you started January 2026 with $12,483.27 in checking. We'll record that as your starting balance — look right?");
  });
  it("carries NO accounting jargon (Cardinal Principle)", () => {
    expect(containsOwnerJargon(copy)).toBe(false);
    expect(copy).not.toMatch(/\bdebit\b|\bcredit\b|journal|ledger|\bGL\b|opening balance equity|1000/i);
  });
  it("periodMonthLabel formats / rejects", () => {
    expect(periodMonthLabel("2026-01-01")).toBe("January 2026");
    expect(periodMonthLabel("nope")).toBeNull();
  });
});
