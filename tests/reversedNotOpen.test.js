import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { openPayablesGL, openReceivablesGL, glAccountBalance } from "../src/lib/reports.js";
import { computeControlTotals } from "../src/lib/controlTotals.js";
import { openReceivables } from "../src/lib/receivables.js";
import { matchableOpenItems } from "../src/lib/bankMatch.js";
import { classifyTxn } from "../src/lib/txnPresent.js";

// ═════════════════════════════════════════════════════════════════════════════
// C468 — A BILL CANCELED BY A DATED CORRECTION WAS STILL "OPEN" EVERYWHERE. The original of
// a reversal stays live (§12 #14) and its A/P leg is canceled by the reversal's Dr A/P; the
// GL nets to zero, but every list deriving openness from "A/P leg + not flagged paid" read
// the canceled bill as owed — Bills to pay, the bank matcher's universe, the panel's Mark
// as Paid, and the `ap_tie` control total (red by exactly the corrected amount). Run through
// the REAL flatten so the stamp and its readers are proved together, not against a fixture
// that hands the readers a field the flatten never wrote (·3a).
// ═════════════════════════════════════════════════════════════════════════════
const acct = (code, name) => ({ code, name });
const je = (id, date, description, lines, extra = {}) => ({
  id, entry_date: date, description, status: "posted", deleted_at: null, source: "universal_upload",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: acct(l.code, l.name) })),
  ...extra,
});
const AP = "2000", AR = "1100", CASH = "1000";
const bill = je("b1", "2026-07-10", "Sysco – produce", [{ code: "5010", name: "Food Cost", debit: 500 }, { code: AP, name: "Accounts Payable", credit: 500 }]);
const reversal = je("r1", "2026-09-15", "REVERSAL: Sysco – produce", [{ code: AP, name: "Accounts Payable", debit: 500 }, { code: "5010", name: "Food Cost", credit: 500 }], { import_metadata: { kind: "reversal", reverses: "b1" } });
const openBill = je("b2", "2026-08-02", "Roma – cheese", [{ code: "5010", name: "Food Cost", debit: 200 }, { code: AP, name: "Accounts Payable", credit: 200 }]);
const invoice = je("i1", "2026-07-12", "Acme – catering", [{ code: AR, name: "Accounts Receivable", debit: 900 }, { code: "4000", name: "Sales", credit: 900 }]);
const invRev = je("r2", "2026-09-15", "REVERSAL: Acme – catering", [{ code: "4000", name: "Sales", debit: 900 }, { code: AR, name: "Accounts Receivable", credit: 900 }], { import_metadata: { kind: "reversal", reverses: "i1" } });

describe("C468 · a reversed original is canceled, not open", () => {
  const rows = flattenJournalEntries([bill, reversal, openBill, invoice, invRev]);
  const b1 = rows.find((r) => r.db_entry_id === "b1");
  const b2 = rows.find((r) => r.db_entry_id === "b2");
  const i1 = rows.find((r) => r.db_entry_id === "i1");

  it("the REVERSAL itself flattens as a bill-shaped row and was listed as a second open bill — no longer", () => {
    const r1 = rows.find((r) => r.db_entry_id === "r1");
    expect(r1.gl_code).toBe("5010"); expect(r1.secondary_gl_code).toBe(AP); expect(r1.amount).toBe(500);   // the shape that fooled every reader
    expect(openPayablesGL(rows, AP).map((r) => r.db_entry_id)).not.toContain("r1");
  });
  it("the flatten stamps reversed_by on the original and on nothing else", () => {
    expect(b1.reversed_by).toBe("r1");
    expect(i1.reversed_by).toBe("r2");
    expect(b2.reversed_by).toBeUndefined();
    expect(rows.find((r) => r.db_entry_id === "r1").reversed_by).toBeUndefined();
  });
  it("the GL still nets both entries — the A/P balance is the open bill alone", () => {
    expect(glAccountBalance(AP, rows)).toBe(200);
  });
  it("Bills to pay and Money owed to you list only the live items", () => {
    expect(openPayablesGL(rows, AP).map((r) => r.db_entry_id)).toEqual(["b2"]);
    expect(openReceivablesGL(rows, AR)).toEqual([]);
    expect(openReceivables(rows, AR)).toEqual([]);
  });
  it("the bank matcher's open universe excludes it", () => {
    expect(matchableOpenItems(rows, { arCode: AR, apCode: AP }).map((r) => r.db_entry_id)).toEqual(["b2"]);
  });
  it("the panel offers nothing to pay on it, and still offers it on the open bill", () => {
    expect(classifyTxn(b1, { apCode: AP, arCode: AR }).settleAction).toBeNull();
    expect(classifyTxn(b2, { apCode: AP, arCode: AR }).settleAction).toBe("pay");
    expect(classifyTxn(i1, { apCode: AP, arCode: AR }).settleAction).toBeNull();
  });
  it("the ap_tie control total ties — it failed by the corrected amount before", () => {
    const ct = computeControlTotals({ invoices: rows, codes: { ap: AP, ar: AR } });
    const tie = ct.checks.find((c) => c.key === "ap_tie");
    expect(tie.ties).toBe(true);
    // And the failure it replaces: with the readers blind to reversals, the sum of open
    // bills was 1,000 (the bill AND its correction) against a balance of 200.
    const arTie = ct.checks.find((c) => c.key === "ar_tie");
    expect(arTie.ties).toBe(true);
  });
  it("a reversal that is itself deleted or voided stamps nothing", () => {
    const gone = flattenJournalEntries([bill, { ...reversal, deleted_at: "2026-09-16" }]);
    expect(gone.find((r) => r.db_entry_id === "b1").reversed_by).toBeUndefined();
    const voided = flattenJournalEntries([bill, { ...reversal, status: "voided" }]);
    expect(voided.find((r) => r.db_entry_id === "b1").reversed_by).toBeUndefined();
  });
});

describe("C468 · markBillPaid refuses a reversed bill on GL truth", () => {
  it("the refusal reads the live reversal, before any write", () => {
    const app = fs.readFileSync("src/App.jsx", "utf8");
    const i = app.indexOf("const markBillPaidOnce = async (entryId,");
    const fn = app.slice(i, app.indexOf("const payEntry = buildPaymentEntry(inv, side, {", i));
    expect(fn).toMatch(/\n\s*if \(dbId && alreadyReversed\(invoicesRef\.current, dbId\)\) \{[\s\S]*?return false;/);
    expect(fn.indexOf("alreadyReversed(invoicesRef.current, dbId)")).toBeLessThan(fn.indexOf("apply({ payment_status: newStatus"));
  });
});
