import { describe, it, expect } from "vitest";
import { deductionBreakdown } from "../src/lib/tax.js";

// C489 — the deduction tracker summed `amount` unsigned per account, so a corrected rent bill
// counted twice: the bill AND its correction (a credit to the same account) both added.
const rc = (r) => ({ rent_occupancy: { code: "6100", name: "Rent & Occupancy" } })[r] || null;
const row = (id, amount, debit_credit, extra = {}) => ({ id, vendor: "Franklin Ave", amount, date: "2026-03-01", gl_code: "6100", gl_name: "Rent & Occupancy", type: "expense", debit_credit, status: "posted", ...extra });
describe("C489", () => {
  it("a bill and its correction net to zero; a bill alone counts once", () => {
    const rent = (d) => (d.categories || d).find((c) => /rent/i.test(c.label || c.name || c.category || ""));
    const one = deductionBreakdown([row("a", 2400, "debit")], 2026, rc);
    expect(rent(one).amount ?? rent(one).total).toBe(2400);
    const corrected = deductionBreakdown([row("a", 2400, "debit"), row("r", 2400, "credit", { import_metadata: { kind: "reversal", reverses: "a" } })], 2026, rc);
    expect(rent(corrected).amount ?? rent(corrected).total).toBe(0);
  });
});
