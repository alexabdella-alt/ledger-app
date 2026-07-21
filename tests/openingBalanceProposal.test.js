import { describe, it, expect } from "vitest";
import {
  deriveStatementOpening, shouldProposeOpening, openingDiscrepancy,
  markAlreadyBooked, bankTxnKey, openingProposalCopy, periodMonthLabel,
} from "../src/lib/openingBalanceProposal.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

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

describe("markAlreadyBooked — idempotent re-upload (no duplicate bookings)", () => {
  // The 3 lines already booked to Cash (1000): each flattened row's offset (secondary) is 1000.
  const existing = JAN.transactions.map((t, i) => ({
    id: `je${i}`, date: t.date, amount: Math.abs(t.amount), vendor: t.description,
    gl_code: t.amount < 0 ? "6500" : "4000", secondary_gl_code: "1000", status: "booked",
  }));
  it("re-uploading the SAME statement flags every line already-booked → nothing re-books", () => {
    const marked = markAlreadyBooked(JAN.transactions, existing, { offsetCode: "1000" });
    expect(marked.every(t => t.already_booked)).toBe(true);
    expect(marked.filter(t => !t.already_booked).length).toBe(0);   // none would book
  });
  it("a genuinely NEW line (not yet booked) is not flagged", () => {
    const withNew = [...JAN.transactions, { date: "2026-01-25", description: "NEW CHARGE", amount: -50, balance: 15607.60 }];
    const marked = markAlreadyBooked(withNew, existing, { offsetCode: "1000" });
    expect(marked.filter(t => !t.already_booked).length).toBe(1);
    expect(marked.find(t => t.description === "NEW CHARGE").already_booked).toBe(false);
  });
  it("multiset: two identical charges need two existing bookings to both be flagged", () => {
    const dup = [{ date: "2026-02-01", description: "COFFEE", amount: -5, balance: 100 }, { date: "2026-02-01", description: "COFFEE", amount: -5, balance: 95 }];
    const oneExisting = [{ id: "x", date: "2026-02-01", amount: 5, vendor: "COFFEE", secondary_gl_code: "1000", status: "booked" }];
    const marked = markAlreadyBooked(dup, oneExisting, { offsetCode: "1000" });
    expect(marked.filter(t => t.already_booked).length).toBe(1);   // only ONE matched
  });
  it("bankTxnKey is content-based (date + magnitude + normalized description)", () => {
    expect(bankTxnKey({ date: "2026-01-03", amount: -100, description: "ACH  DEBIT  RENT" }))
      .toBe(bankTxnKey({ date: "2026-01-03", amount: 100, description: "ach debit rent" }));
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
