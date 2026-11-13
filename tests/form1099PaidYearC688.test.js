// C688 — a 1099 follows the year a vendor was PAID, and how (review of C679).
import { describe, it, expect } from "vitest";
import { paidRowsForYear, tracker1099Rows, paidByCardOrNetwork } from "../src/lib/form1099.js";

const CHART = [
  { code: "1000", name: "Checking", system_role: "cash" },
  { code: "2000", name: "Accounts Payable", system_role: "accounts_payable" },
  { code: "2150", name: "Amex Business" },
  { code: "2160", name: "Gift Card Liability" },
  { code: "6800", name: "Professional Services", system_role: "professional_services" },
  { code: "5100", name: "Direct Labor", system_role: "direct_labor" },
];
const AP = { apCodes: new Set(["2000"]), cardCodes: new Set(["2150"]) };
const bill = (o = {}) => ({ id: "b1", db_entry_id: "b1", vendor: "Jo Design", date: "2025-12-20", gl_code: "6800", secondary_gl_code: "2000", amount: 1500, debit_credit: "debit", payment_status: "unpaid", ...o });
const pay = (o = {}) => ({ id: "p1", db_entry_id: "p1", vendor: "Jo Design", date: "2026-01-10", gl_code: "2000", secondary_gl_code: "1000", amount: 1500, import_metadata: { kind: "ap_payment", payment_for: "b1" }, ...o });
const contacts = [{ name: "Jo Design", type: "vendor", business_type: "sole_prop" }];

describe("C688 — the year of the payment, not of the bill", () => {
  it("a December bill paid in January counts in January's year", () => {
    expect(paidRowsForYear([bill(), pay()], 2025, AP)).toEqual([]);
    expect(paidRowsForYear([bill(), pay()], 2026, AP).filter((r) => r.id === "b1")).toHaveLength(1);
  });
  it("so it's under 2026's $2,000 floor — no 1099 — and not in 2025 at all", () => {
    const in2025 = tracker1099Rows({ invoices: [bill(), pay()], contacts, chart: CHART, year: 2025 });
    const in2026 = tracker1099Rows({ invoices: [bill(), pay()], contacts, chart: CHART, year: 2026 });
    expect(in2025).toEqual([]);
    expect(in2026[0].status.key).toBe("tracking");
  });
  it("an unpaid bill counts in no year yet", () => {
    expect(paidRowsForYear([bill()], 2025, AP)).toEqual([]);
    expect(tracker1099Rows({ invoices: [bill({ amount: 900 })], contacts, chart: CHART, year: 2025 })).toEqual([]);
  });
  it("a reversed payment doesn't count as paid", () => {
    expect(paidRowsForYear([bill(), pay({ reversed_by: "r1" })], 2026, AP)).toEqual([pay({ reversed_by: "r1" })]);   // only the settlement row itself passes through (skipped later as a settlement)
  });
  it("a bill marked paid with no payment entry uses its paid date", () => {
    expect(paidRowsForYear([bill({ payment_status: "paid", paid_at: "2026-01-05T10:00:00Z" })], 2026, AP)).toHaveLength(1);
    expect(paidRowsForYear([bill({ payment_status: "paid", paid_at: "2026-01-05T10:00:00Z" })], 2025, AP)).toHaveLength(0);
  });
  it("a purchase paid on the spot keeps its own date", () => {
    expect(paidRowsForYear([bill({ secondary_gl_code: "1000" })], 2025, AP)).toHaveLength(1);
  });
});

describe("C688 — paid from a card is the card network's 1099-K", () => {
  it("a bill paid from the Amex is a card payment, whatever the method says", () => {
    const rows = paidRowsForYear([bill({ amount: 3000 }), pay({ amount: 3000, secondary_gl_code: "2150", payment_method_used: "ach" })], 2026, AP);
    expect(paidByCardOrNetwork(rows.find((r) => r.id === "b1"))).toBe(true);
    const t = tracker1099Rows({ invoices: [bill({ amount: 3000 }), pay({ amount: 3000, secondary_gl_code: "2150" })], contacts, chart: CHART, year: 2026 });
    expect(t[0].status.key).toBe("none");
  });
  it("a card set up in Settings counts as a card even with a plain name", () => {
    const chart = [...CHART, { code: "2170", name: "Business Line" }];
    const invoices = [bill({ amount: 3000 }), pay({ amount: 3000, secondary_gl_code: "2170" })];
    expect(tracker1099Rows({ invoices, contacts, chart, year: 2026 })[0].status.key).toBe("needs");
    expect(tracker1099Rows({ invoices, contacts, chart, year: 2026, bankAccounts: [{ type: "credit_card", gl_code: "2170" }] })[0].status.key).toBe("none");
  });
  it("paid by check is still the payer's 1099", () => {
    const t = tracker1099Rows({ invoices: [bill({ amount: 3000 }), pay({ amount: 3000 })], contacts, chart: CHART, year: 2026 });
    expect(t[0].status.key).toBe("needs");
  });
  it("a gift-card liability is not a card", () => {
    const t = tracker1099Rows({ invoices: [bill({ amount: 3000 }), pay({ amount: 3000, secondary_gl_code: "2160" })], contacts, chart: CHART, year: 2026 });
    expect(t[0].status.key).toBe("needs");
  });
});

describe("C688 — payroll is wages, never a 1099", () => {
  it("a payroll run on Direct Labor is not counted", () => {
    const run = { id: "pr", vendor: "Jo Design", date: "2026-03-01", gl_code: "5100", secondary_gl_code: "1000", amount: 5000, debit_credit: "debit", source: "payroll" };
    expect(tracker1099Rows({ invoices: [run], contacts, chart: CHART, year: 2026 })).toEqual([]);
    expect(tracker1099Rows({ invoices: [{ ...run, source: "manual" }], contacts, chart: CHART, year: 2026 })[0].status.key).toBe("needs");
  });
});
